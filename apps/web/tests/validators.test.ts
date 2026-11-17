import { describe, expect, it } from "vitest";
import { clientSchema, jobSchema, workspaceSchema } from "../lib/validators";
import { evidenceStatus, scoreLabel } from "../lib/scoring-ui";

describe("ATS form validation", () => {
  it("requires a meaningful job title and description", () => {
    expect(jobSchema.safeParse({ title: "X", description: "tiny" }).success).toBe(false);
    expect(jobSchema.safeParse({ title: "Engineer", description: "Build and maintain customer-facing services." }).success).toBe(true);
  });
  it("requires a client/workspace name", () => {
    expect(clientSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(workspaceSchema.safeParse({ name: "Talent team" }).success).toBe(true);
  });
});

describe("evidence display", () => {
  it("shows unknown evidence as insufficient rather than a zero score", () => {
    expect(scoreLabel(null)).toBe("Insufficient evidence");
    expect(scoreLabel(0)).toBe("0/100");
  });
  it("labels missing resume evidence clearly", () => {
    expect(evidenceStatus("not_evidenced")).toBe("Not evidenced in CV");
    expect(evidenceStatus("partially_supported")).toBe("partially supported");
  });
});
