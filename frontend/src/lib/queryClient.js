import { QueryClient } from "@tanstack/react-query";

/** Retry only when the server or network failed, never on 4xx (those will not change). */
export function shouldRetry(failureCount, error) {
  const transient = error?.status === 0 || error?.status >= 500;
  return transient && failureCount < 2;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 20_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
