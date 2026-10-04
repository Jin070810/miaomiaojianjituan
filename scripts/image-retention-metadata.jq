# Older Dockerfiles already baked APP_COMMIT_SHA before OCI revision labels
# were added. Read only this specific public build field, never export Env.
def sha: type=="string" and test("^[a-f0-9]{40}$");
.[0] |
(.Config.Labels["org.opencontainers.image.revision"] // null) as $label |
([(.Config.Env//[])[] | select(startswith("APP_COMMIT_SHA=")) | ltrimstr("APP_COMMIT_SHA=")] | unique) as $env |
(if ($label|sha) and (($env|length)==0 or $env==[$label]) then {revision:$label,revisionSource:"oci_label"}
 elif $label==null and ($env|length)==1 and ($env[0]|sha) then {revision:$env[0],revisionSource:"build_environment"}
 else {revision:null,revisionSource:"unknown_or_conflicting"} end) as $version |
{Id,Created,Size,RepoTags:(.RepoTags//[]),RepoDigests:(.RepoDigests//[])} + $version
