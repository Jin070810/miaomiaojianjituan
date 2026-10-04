# Trusted compatibility entries must identify both exact hashes. No wildcard,
# checksum rewrite, unknown mismatch or compatibility-note override is allowed.
def known_variant($row; $canonical):
  any($aliases[0].entries[];
    .migration == $row.name and .recordedChecksum == $row.checksum and .canonicalChecksum == $canonical and
    (.recordedChecksum | test("^[a-f0-9]{64}$")) and (.canonicalChecksum | test("^[a-f0-9]{64}$")) and
    (.evidenceRun | test("^[1-9][0-9]*$")) and (.evidenceCandidate | test("^[a-f0-9]{40}$")));
if $aliases[0].schemaVersion != 1 or ($aliases[0].entries | type) != "array" then
  error("Invalid trusted migration compatibility registry")
else
  map(. as $row | ([ $target[0].migrations[] | select(.path == ($row.name + "/migration.sql")) ][0]) as $match |
    {name:$row.name,recordedChecksum:$row.checksum,canonicalChecksum:$match.sha256,
      verdict:(if $match == null then "missing"
        elif $row.checksum == $match.sha256 then "exact"
        elif known_variant($row; $match.sha256) then "legacy"
        else "mismatch" end)}) as $rows |
  {validChecksums:all($rows[]; .verdict != "mismatch"),
    missingMigrations:[$rows[]|select(.verdict=="missing")|.name],
    mismatchedMigrations:[$rows[]|select(.verdict=="mismatch")|del(.verdict)],
    historicalVariants:[$rows[]|select(.verdict=="legacy")|del(.verdict)]}
end
