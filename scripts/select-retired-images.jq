# Input is an explicit, deduplicated Docker image inventory. Unknown provenance
# and non-project references are never deletion candidates.
. as $inventory |
map(. + {kind: ([.RepoDigests[]? | capture("^ghcr.io/jin070810/miaomiaojianjituan-(?<kind>app|worker)@sha256:[a-f0-9]{64}$") | .kind] | unique)}) |
map(select((.kind|length)==1 and (.revision|type)=="string" and (.revision|test("^[a-f0-9]{40}$"))) | .kind=.kind[0]) as $project |
($project | group_by(.revision) | map({revision:.[0].revision,created:(map(.Created)|max)}) |
  sort_by(.created) | reverse | .[:3] | map(.revision)) as $recent |
([$inventory[] | select((.Id as $id | $used[0]|index($id))!=null or any(.RepoTags[]?; endswith(":production"))) | .revision | select(type=="string")] + $recent | unique) as $protected |
{retainedVersions:$protected,selected:[
  $project[] | . as $image |
  select(($protected|index($image.revision))==null and .Created < $cutoff) |
  select((.Id as $id | $used[0]|index($id))==null) |
  select(all(.RepoDigests[]?; test("^ghcr.io/jin070810/miaomiaojianjituan-"+$image.kind+"@sha256:[a-f0-9]{64}$"))) |
  select(all(.RepoTags[]?; startswith("ghcr.io/jin070810/miaomiaojianjituan-"+$image.kind+":") or startswith("miaomiao-points-"+$image.kind+":"))) |
  {id:.Id,revision,revisionSource,kind,created:.Created,sizeBytes:.Size,refs:((.RepoTags//[])+(.RepoDigests//[])|unique),immutableRefs:(.RepoDigests|unique)}
] | sort_by(.created)} |
. as $result |
.excludedProjectImages = [$inventory[] | . as $image |
  select(any(.RepoDigests[]?; test("^ghcr.io/jin070810/miaomiaojianjituan-(app|worker)@sha256:[a-f0-9]{64}$"))) |
  select(all($result.selected[]; .id!=$image.Id)) |
  {id:.Id,revision,revisionSource,created:.Created,
    reason:(if (.Id as $id|$used[0]|index($id))!=null then "container_reference"
      elif (.revision|type)!="string" then "unknown_or_conflicting_version"
      elif ($protected|index($image.revision))!=null then "retained_version"
      elif .Created>=$cutoff then "younger_than_retention"
      else "unrecognized_or_foreign_reference" end)}]
