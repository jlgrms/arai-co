import { ArgumentsHost, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  it('Prisma P2002 (unique constraint) -> 409 Conflict, not 500', () => {
    const { host, json, status } = mockHost();
    const ex = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`availabilityId`)', {
      code: 'P2002',
      clientVersion: '5.20.0',
    });
    filter.catch(ex, host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, error: 'Conflict', message: 'Resource already exists' }),
    );
  });

  it('Prisma P2025 (record not found) -> 404 Not Found, not 500', () => {
    const { host, json, status } = mockHost();
    const ex = new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
      code: 'P2025',
      clientVersion: '5.20.0',
    });
    filter.catch(ex, host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, error: 'Not Found', message: 'Resource not found' }),
    );
  });

  it('unmapped Prisma code -> still scrubbed 500', () => {
    const { host, json, status } = mockHost();
    const ex = new Prisma.PrismaClientKnownRequestError('something odd', {
      code: 'P1001',
      clientVersion: '5.20.0',
    });
    filter.catch(ex, host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, message: 'Internal server error' }),
    );
  });
});
