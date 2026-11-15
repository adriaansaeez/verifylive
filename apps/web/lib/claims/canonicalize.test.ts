import { describe, expect, it } from "vitest";
import { parseCanonicalClaims } from "@/lib/claims/canonicalize";

describe("parseCanonicalClaims", () => {
  it("parses concise atomic statements and queries", () => {
    expect(parseCanonicalClaims('{"claims":[{"statement":"El sistema ferroviario español es seguro.","queries":["seguridad ferroviaria España"]}]}'))
      .toEqual([{ statement: "El sistema ferroviario español es seguro.", queries: ["seguridad ferroviaria España"] }]);
  });

  it("rejects malformed output and questions", () => {
    expect(parseCanonicalClaims("not json")).toEqual([]);
    expect(parseCanonicalClaims('{"claims":[{"statement":"¿Es seguro el tren?","queries":[]}]}')).toEqual([]);
  });
});
