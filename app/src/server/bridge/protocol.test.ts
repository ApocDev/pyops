import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  type BridgeResponse,
  PROTOCOL_VERSION,
  errorResponse,
  parseRequest,
  serialize,
} from "./protocol.ts";

describe("parseRequest", () => {
  it("parses a well-formed request from a string", () => {
    const req = parseRequest(
      JSON.stringify({
        protocol_version: 4,
        type: "ping",
        request_id: "abc",
        tick: 123,
        player: "jim",
        mod_version: "0.1.0",
        payload: { hello: "world" },
      }),
    );
    expect(req).not.toBeNull();
    expect(req).toEqual({
      protocol_version: 4,
      type: "ping",
      request_id: "abc",
      tick: 123,
      player: "jim",
      mod_version: "0.1.0",
      payload: { hello: "world" },
    });
  });

  it("parses from a Buffer", () => {
    const req = parseRequest(Buffer.from(JSON.stringify({ type: "pong" }), "utf8"));
    expect(req?.type).toBe("pong");
  });

  it("defaults a missing protocol_version to 0 and leaves optionals undefined", () => {
    const req = parseRequest(JSON.stringify({ type: "status" }));
    expect(req).toEqual({
      protocol_version: 0,
      type: "status",
      request_id: undefined,
      tick: undefined,
      player: undefined,
      mod_version: undefined,
      payload: undefined,
    });
  });

  it("rejects wrong-typed fields by coercing/dropping them", () => {
    const req = parseRequest(
      JSON.stringify({ type: "x", protocol_version: "4", request_id: 9, tick: "t" }),
    );
    expect(req?.protocol_version).toBe(0); // non-number → 0
    expect(req?.request_id).toBeUndefined(); // non-string → undefined
    expect(req?.tick).toBeUndefined();
  });

  it("returns null when type is missing or not a string", () => {
    expect(parseRequest(JSON.stringify({ foo: "bar" }))).toBeNull();
    expect(parseRequest(JSON.stringify({ type: 42 }))).toBeNull();
  });

  it("returns null for non-object JSON and invalid JSON", () => {
    expect(parseRequest("null")).toBeNull();
    expect(parseRequest("42")).toBeNull();
    expect(parseRequest("not json{")).toBeNull();
    expect(parseRequest("")).toBeNull();
  });
});

describe("serialize", () => {
  it("round-trips a response through serialize → JSON.parse", () => {
    const res: BridgeResponse = {
      type: "pong",
      request_id: "abc",
      protocol_version: PROTOCOL_VERSION,
      payload: { ok: true },
    };
    const buf = serialize(res);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(JSON.parse(buf.toString("utf8"))).toEqual(res);
  });

  it("a serialized response parses back as a request envelope (type preserved)", () => {
    const buf = serialize({ type: "ping", payload: { n: 1 } });
    expect(parseRequest(buf)?.type).toBe("ping");
  });
});

describe("errorResponse", () => {
  it("builds an error envelope carrying the message and echoing request_id", () => {
    expect(errorResponse("boom", "req-1")).toEqual({
      type: "error",
      request_id: "req-1",
      payload: { message: "boom" },
    });
  });

  it("omits request_id when not given", () => {
    const res = errorResponse("boom");
    expect(res.type).toBe("error");
    expect(res.request_id).toBeUndefined();
  });
});

describe("PROTOCOL_VERSION lockstep with the mod", () => {
  it("matches the PROTOCOL_VERSION declared in mod/control.lua", () => {
    // The wire contract must be bumped on BOTH sides together. This guard fails
    // the build if app and mod drift apart.
    const controlLua = fileURLToPath(new URL("../../../../mod/control.lua", import.meta.url));
    const src = readFileSync(controlLua, "utf8");
    const m = src.match(/local\s+PROTOCOL_VERSION\s*=\s*(\d+)/);
    expect(m, "PROTOCOL_VERSION not found in mod/control.lua").not.toBeNull();
    expect(Number(m![1])).toBe(PROTOCOL_VERSION);
  });
});
