import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

// Single, consistent error envelope for the whole API (ai-dev-instructions §8).
//   { statusCode, error, message, path, timestamp }
// `message` is ALWAYS a string (validation arrays are joined with '; ').
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, error, message } = this.resolve(exception);

    // Log 5xx server-side with the stack; never expose it to the client.
    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(statusCode).json({
      statusCode,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private resolve(exception: unknown): {
    statusCode: number;
    error: string;
    message: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      let message: string;
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const m = (res as Record<string, unknown>).message;
        if (Array.isArray(m)) {
          // ValidationPipe returns an array of constraint messages -> join.
          message = m.join('; ');
        } else if (typeof m === 'string') {
          message = m;
        } else {
          message = exception.message;
        }
      } else {
        message = exception.message;
      }

      return { statusCode: status, error: this.reasonPhrase(status), message };
    }

    // Unknown/unexpected: scrub, never leak internals.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: this.reasonPhrase(HttpStatus.INTERNAL_SERVER_ERROR),
      message: 'Internal server error',
    };
  }

  private reasonPhrase(status: number): string {
    const map: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      500: 'Internal Server Error',
    };
    return map[status] ?? 'Error';
  }
}
