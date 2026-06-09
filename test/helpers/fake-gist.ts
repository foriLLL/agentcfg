import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type GistRequest = {
  url: string | undefined;
  method: string | undefined;
  authorization: string | undefined;
  accept: string | undefined;
  userAgent: string | undefined;
  contentType: string | undefined;
  body: string;
};

export type FakeGistServer = {
  apiBaseUrl: string;
  requests: GistRequest[];
  close(): Promise<void>;
};

export type FakeGistResponse = {
  status: number;
  body: unknown;
  etag?: string;
};

export function buildGistBody(content: string, revision = 'test-revision'): Record<string, unknown> {
  return {
    files: {
      'agentcfg.yaml': {
        filename: 'agentcfg.yaml',
        content,
      },
    },
    history: [{ version: revision }],
  };
}

export async function startFakeGistServer(response: FakeGistResponse | FakeGistResponse[]): Promise<FakeGistServer> {
  const requests: GistRequest[] = [];
  const server = createServer((request: IncomingMessage, serverResponse: ServerResponse) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      const currentResponse = Array.isArray(response)
        ? response[Math.min(requests.length, response.length - 1)]
        : response;
      requests.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.authorization,
        accept: request.headers.accept,
        userAgent: request.headers['user-agent'],
        contentType: request.headers['content-type'],
        body,
      });
      serverResponse.statusCode = currentResponse.status;
      serverResponse.setHeader('content-type', 'application/json');
      serverResponse.setHeader('connection', 'close');
      if (currentResponse.etag !== undefined) {
        serverResponse.setHeader('etag', currentResponse.etag);
      }
      serverResponse.end(JSON.stringify(currentResponse.body));
    });
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, '127.0.0.1', resolvePromise);
  });

  const address = server.address();
  assert.notEqual(address, null);
  if (address === null || typeof address === 'string') {
    throw new Error('Fake Gist server did not bind to a TCP port');
  }

  return {
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error !== undefined) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      }),
  };
}
