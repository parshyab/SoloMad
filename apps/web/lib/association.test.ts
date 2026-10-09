import { describe, expect, it } from "vitest";
import { associationDocument } from "./association";

describe("apple app site association", () => {
  it("does not publish a placeholder team id", () => {
    expect(associationDocument(undefined)).toBeNull();
    expect(associationDocument("TEAMID")).toBeNull();
    expect(associationDocument("REPLACE_ME")).toBeNull();
  });

  it("uses the supplied team prefix and bundle id", () => {
    expect(associationDocument("AB12CD34EF")).toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appIDs: ["AB12CD34EF.app.solomad.ios"],
            components: [{ "/": "/a/*", comment: "Shared activities only" }],
          },
        ],
      },
    });
  });
});
