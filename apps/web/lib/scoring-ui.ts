export function scoreLabel(score: number | null | undefined): string {
  return score == null ? "Insufficient evidence" : `${score}/100`;
}

export function evidenceStatus(state: string): string {
  return state === "not_evidenced" ? "Not evidenced in CV" : state.replaceAll("_", " ");
}
