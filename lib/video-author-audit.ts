type StoredAuthor = {
  userId: string;
  fetchedAuthorUid: string | null;
  authorEvidenceVersion: number | null;
  verifiedBindingId: string | null;
};

type HistoricalBinding = { id: string; userId: string; platform: string; authorUid: string };

/** Revocation affects future credit; today's binding status is not historical proof. */
export function historicalAuthorIssues(video: StoredAuthor, platform: string, fetchedUid: string | null, binding: HistoricalBinding | null) {
  const issues: string[] = [];
  if (video.authorEvidenceVersion !== 1 || !video.fetchedAuthorUid || !video.verifiedBindingId) {
    issues.push("legacy-author-evidence-unavailable");
  } else {
    if (!binding || binding.id !== video.verifiedBindingId || binding.userId !== video.userId || binding.platform !== platform || binding.authorUid !== video.fetchedAuthorUid) issues.push("stored-author-binding-mismatch");
    if (fetchedUid && fetchedUid !== video.fetchedAuthorUid) issues.push("fetched-author-uid-mismatch");
  }
  if (!fetchedUid) issues.push("fetched-author-evidence-unavailable");
  return issues;
}
