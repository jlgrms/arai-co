import { ArgumentsHost, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function mockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/test/path', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('AllExceptionsFilter (consistent error shape)', () => {
  const filter = new AllExceptionsFilter();

  it('HttpException with string message -> envelope with that message', () => {
    const { host, json, status } = mockHost();
    filter.catch(new NotFoundException('Doctor not found'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        error: 'Not Found',
        message: 'Doctor not found',
        path: '/test/path',
      }),
    );
  });

  it('validation array message -> joined into ONE string', () => {
    const { host, json } = mockHost();
    const ex = new BadRequestException({
      message: ['email must be an email', 'password too short'],
      error: 'Bad Request',
      statusCode: 400,
    });
    filter.catch(ex, host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'Bad Request',
        message: 'email must be an email; password too short',
      }),
    );
  });

  it('unknown error -> scrubbed 500, no leak', () => {
    const { host, json, status } = mockHost();
    filter.catch(new Error('secret db connection string leaked'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal server error',
      }),
    );
    // ensure the raw message did not leak
    const payload = json.mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('includes ISO timestamp', () => {
    const { host, json } = mockHost();
    filter.catch(new NotFoundException('x'), host);
    const payload = json.mock.calls[0][0];
    expect(new Date(payload.timestamp).toString()).not.toBe('Invalid Date');
  });
});
