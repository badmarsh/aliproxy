import { createLogger } from "./logger.js";
import { config } from "./config.js";
import type {
  UpstreamError,
  RateLimitHints,
  KeyStatus,
  ApiKeyWithSecret,
} from "./types.js";

const log = createLogger("dashscope-adapter");

export class DashScopeAdapter {
  async listModels(
    key: ApiKeyWithSecret,
    timeoutMs: number = config.proxy.requestTimeoutSeconds * 1000,
  ): Promise<{ id: string; object: string }[]> {
    const url = `${key.base_url}/models`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key.secret}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await this.parseError(response);
        throw error;
      }

      const data = (await response.json()) as any;
      return data.data || [];
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw {
          status: 504,
          code: "upstream_timeout",
          message: `Upstream /models request timed out after ${timeoutMs}ms`,
          classifiedStatus: "rate_limited" as KeyStatus,
        };
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async chatCompletions(
    request: any,
    key: ApiKeyWithSecret,
    timeoutMs: number = config.proxy.requestTimeoutSeconds * 1000,
  ): Promise<Response> {
    const url = `${key.base_url}/chat/completions`;

    log.debug("Forwarding chat completions", {
      key_id: key.id,
      model: request.model,
      stream: request.stream,
      url,
      timeoutMs,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      return response;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        const timeoutError: UpstreamError = {
          status: 504,
          code: "upstream_timeout",
          message: `Upstream request timed out after ${timeoutMs}ms`,
          classifiedStatus: "rate_limited",
        };
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async embeddings(
    request: any,
    key: ApiKeyWithSecret,
    timeoutMs: number = config.proxy.requestTimeoutSeconds * 1000,
  ): Promise<Response> {
    const url = `${key.base_url}/embeddings`;

    log.debug("Forwarding embeddings", {
      key_id: key.id,
      model: request.model,
      url,
      timeoutMs,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      return response;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        const timeoutError: UpstreamError = {
          status: 504,
          code: "upstream_timeout",
          message: `Upstream embeddings request timed out after ${timeoutMs}ms`,
          classifiedStatus: "rate_limited",
        };
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  classifyError(status: number, errorCode: string, errorMessage?: string): UpstreamError {
    let classifiedStatus: KeyStatus = "active";

    if (status === 401 || errorCode === "invalid_api_key") {
      classifiedStatus = "invalid";
    } else if (errorCode === "insufficient_quota") {
      classifiedStatus = "quota_exhausted";
    } else if (errorCode === "AccessDenied.Unpurchased") {
      classifiedStatus = "disabled";
    } else if (status === 429) {
      if (errorMessage?.includes("quota") || errorMessage?.includes("exceeded")) {
        classifiedStatus = "quota_exhausted";
      } else {
        classifiedStatus = "rate_limited";
      }
    }

    return {
      status,
      code: errorCode,
      message: errorMessage || "",
      classifiedStatus,
    };
  }

  readRateLimitHints(response: Response): RateLimitHints | null {
    const headers = response.headers;
    const rpmLimit = headers.get("x-ratelimit-limit-requests");
    const rpmRemaining = headers.get("x-ratelimit-remaining-requests");
    const rpmReset = headers.get("x-ratelimit-reset-requests");

    if (!rpmLimit && !rpmRemaining) {
      return null;
    }

    return {
      rpmLimit: rpmLimit ? parseInt(rpmLimit, 10) : null,
      rpmRemaining: rpmRemaining ? parseInt(rpmRemaining, 10) : null,
      rpmReset: rpmReset ? parseInt(rpmReset, 10) : null,
    };
  }

  async parseError(response: Response): Promise<UpstreamError> {
    try {
      const body = (await response.json()) as any;
      const error = body.error || {};
      return this.classifyError(
        response.status,
        error.code || error.type || "unknown",
        error.message || response.statusText,
      );
    } catch {
      return {
        status: response.status,
        code: "unknown",
        message: response.statusText,
        classifiedStatus: response.status === 401 ? "invalid" : "unknown",
      };
    }
  }
}

export const adapter = new DashScopeAdapter();
