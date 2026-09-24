#!/usr/bin/env bash
# Release @softspark/dsh-codex. The only supported way to create a release tag.
#
#   npm run release -- X.Y.Z             gates, Linux run, pack smoke, tag, push, watch publish
#   npm run release -- X.Y.Z --dry-run   everything up to the tag; prints the rest
#   scripts/release.sh --gates-only      the gate alone (what the Linux container runs)
#
# GitHub Actions only publishes the tag; nothing there re-runs these checks, so
# a tag made by hand ships whatever was on the commit. See
# kb/procedures/sop-release.md.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

PKG="@softspark/dsh-codex"
GH_REPO="softspark/dsh-codex"
BRANCH="main"
LINUX_IMAGE="node:24"
# The older DSH host seams the peer range still promises. The lockfile pins the
# newest; this set is installed over it in a scratch copy only.
LEGACY_DSH="@deepseek-ai/dsh-attachment@0.1.1-rc.2 @deepseek-ai/dsh-llm@0.1.1-rc.2 @deepseek-ai/dsh-session@0.1.1-rc.2"

die()  { printf 'release: %s\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

# One gate per line on screen, full output in the log. A failure prints the
# tail so the cause is visible without opening the file.
LOG=""
run() {
  local name="$1"; shift
  printf '  %-44s ' "$name"
  printf '\n### %s\n$ %s\n' "$name" "$*" >>"$LOG"
  if "$@" >>"$LOG" 2>&1; then
    echo ok
  else
    echo FAILED
    printf -- '--- last 40 lines of %s\n' "$LOG"
    tail -n 40 "$LOG"
    exit 1
  fi
}

# The legacy install resolved differently under other npm releases; the version
# in packageManager is the reviewed one.
check_npm_version() {
  local want
  want="$(node -p "require('./package.json').packageManager.split('@')[1]")"
  [ "$(npm --version)" = "$want" ] || { echo "npm $(npm --version), packageManager wants $want"; return 1; }
}

# Copies the files git knows about (never node_modules) to stdout as a tar stream.
tar_tracked() {
  local f tar_flags=()
  tar --version | grep -q bsdtar && tar_flags=(--no-xattrs --no-mac-metadata)
  git ls-files -z --cached --others --exclude-standard \
    | while IFS= read -r -d '' f; do [ -e "$f" ] && printf '%s\0' "$f"; done \
    | COPYFILE_DISABLE=1 tar ${tar_flags[@]+"${tar_flags[@]}"} --null -T - -cf -
}

# DSH 0.1.1-rc.2 compatibility, in a scratch copy so the checkout's
# node_modules keeps the locked graph. `run` calls this in an `if`, where set -e
# does not apply: every step carries its own `|| return 1`.
legacy_dsh_compat() {
  local work
  work="$(mktemp -d)" || return 1
  # Inside the Linux container there is no .git: the copy is already clean
  # apart from what the gates just installed.
  if [ -d .git ]; then tar_tracked | tar -xf - -C "$work" || return 1
  else tar --exclude=./node_modules -cf - . | tar -xf - -C "$work" || return 1; fi
  (
    cd "$work" || exit 1
    npm ci --ignore-scripts || exit 1
    # shellcheck disable=SC2086 # LEGACY_DSH is a word list on purpose
    npm install --no-save --package-lock=false --ignore-scripts $LEGACY_DSH || exit 1
    # npm ls exits 1 here by design: the override is "invalid" against the
    # devDependency pin. Only the resolved version matters.
    installed="$(npm ls --depth=0 @deepseek-ai/dsh-llm 2>&1 || true)"
    echo "$installed"
    grep -q 'dsh-llm@0\.1\.1-rc\.2' <<<"$installed" || exit 1
    npm run typecheck || exit 1
    npm test || exit 1
  ) || return 1
  rm -rf "$work"
}

sarif() { node scripts/audit.mjs --sarif >"$SARIF"; }

# The publish job is the one place provenance and script-free publishing can be
# lost. Comments are stripped first so prose cannot satisfy the check.
check_publish_controls() {
  local code
  code="$(sed 's/#.*//' .github/workflows/publish.yml)"
  printf '%s' "$code" | grep -q -- '--provenance' || { echo "publish.yml lost --provenance"; return 1; }
  printf '%s' "$code" | grep -q 'id-token: write' || { echo "publish.yml lost id-token: write"; return 1; }
  printf '%s' "$code" | grep -q -- 'npm publish.*--ignore-scripts' || { echo "publish.yml lost --ignore-scripts"; return 1; }
}

gates() {
  run "npm matches packageManager"           check_npm_version
  run "npm ci --ignore-scripts"              npm ci --ignore-scripts
  run "verify (files, versions, KB)"         npm run verify
  run "typecheck"                            npm run typecheck
  run "lint"                                 npm run lint
  run "test:coverage (70% threshold)"        npm run test:coverage
  run "build"                                npm run build
  run "audit:dependencies (high+)"           npm run audit:dependencies
  run "audit:signatures"                     npm run audit:signatures
  run "audit (source rules)"                 npm run audit
  run "audit:permissions"                    npm run audit:permissions
  run "SARIF report"                         sarif
  run "package:check (npm pack --dry-run)"   npm run package:check
  run "publish controls in publish.yml"      check_publish_controls
  run "DSH 0.1.1-rc.2 compatibility"         legacy_dsh_compat
  # Summary only; a format change must not fail a green gate.
  sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -E '^ *Tests +[0-9]+ passed' | sed -n '1s/^ */  suite: /p' || true
  grep -E '^All files' "$LOG" | sed -En '1{s/ +/ /g; s/ $//; s/^/  coverage (stmts|branch|funcs|lines): /p;}' || true
}

# The tarball the tag will publish, built here and imported once. It is
# unpacked under node_modules so its bare imports resolve against the locked
# dependencies, the way an installed copy would.
pack_smoke() {
  local work tarball f target="node_modules/.release-smoke/dsh-codex"
  work="$(mktemp -d)" || return 1
  tarball="$(npm pack --ignore-scripts --pack-destination "$work" | tail -n 1)" || return 1
  tar -tzf "$work/$tarball" | sed 's#^package/##' >"$work/entries.txt" || return 1
  cat "$work/entries.txt"
  for f in lib/index.js lib/index.d.ts cordis.patch.yml LICENSE NOTICE README.md CHANGELOG.md package.json; do
    grep -qx "$f" "$work/entries.txt" || { echo "missing from tarball: $f"; return 1; }
  done
  ! grep -Eq '^(src|tests|kb|scripts)/' "$work/entries.txt" || { echo "tarball ships sources, tests, KB or scripts"; return 1; }
  rm -rf "$target" && mkdir -p "$target" || return 1
  tar -xzf "$work/$tarball" -C "$target" --strip-components 1 || return 1
  node --input-type=module -e "
    const m = await import('./$target/lib/index.js');
    if (m.name !== 'dsh-codex' || typeof m.apply !== 'function') throw new Error('unexpected entry exports');
    console.log('import ok: name=' + m.name + ', apply=' + typeof m.apply);
  " || return 1
  rm -rf "$target" "$work"
}

# Step 4 applies: the app-server transport spawns and signals a child process,
# and vitest, rollup and the coverage provider load platform-native binaries.
# npm ci inside the container installs the Linux builds. The old CI ran the
# suite on Linux, macOS and Windows; Windows has no local equivalent.
#
# The repository is copied in as a tar stream of the files git knows about,
# never mounted, so nothing in the container can write back to the checkout.
linux_gates() {
  local npm_version
  npm_version="$(node -p "require('./package.json').packageManager.split('@')[1]")"
  tar_tracked | docker run --rm -i -e NPM_VERSION="$npm_version" "$LINUX_IMAGE" bash -euo pipefail -c '
    npm install --global --ignore-scripts "npm@$NPM_VERSION" >/dev/null
    mkdir /work && tar -xf - -C /work && chown -R node:node /work
    cd /work && runuser -u node -- bash scripts/release.sh --gates-only'
}

watch_publish() {
  local version="$1" tag="$2" run_id="" i
  for i in $(seq 1 30); do
    run_id="$(gh run list --repo "$GH_REPO" --workflow publish.yml --branch "$tag" \
      --json databaseId --jq '.[0].databaseId // empty')"
    [ -n "$run_id" ] && break
    sleep 10
  done
  [ -n "$run_id" ] || die "no publish run appeared for $tag"
  gh run watch "$run_id" --repo "$GH_REPO" --exit-status || die "publish run $run_id failed"
  # A fresh version can 404 for a minute or two after publish succeeds.
  for i in $(seq 1 30); do
    [ "$(npm view "$PKG@$version" version 2>/dev/null)" = "$version" ] && break
    [ "$i" = 30 ] && die "$PKG@$version is not on the registry"
    sleep 10
  done
  gh release view "$tag" --repo "$GH_REPO" >/dev/null || die "no GitHub Release for $tag"
  echo "published: $PKG@$version, GitHub Release $tag"
}

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

VERSION="" DRY_RUN=0 GATES_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --gates-only) GATES_ONLY=1 ;;
    -h|--help)    usage ;;
    -*)           die "unknown option: $arg" ;;
    *)            [ -z "$VERSION" ] || die "one version only"; VERSION="$arg" ;;
  esac
done

TMP_ROOT="${TMPDIR:-/tmp}"; TMP_ROOT="${TMP_ROOT%/}"

if [ "$GATES_ONLY" = 1 ]; then
  LOG="$TMP_ROOT/dsh-codex-gates.log"; : >"$LOG"
  SARIF="$TMP_ROOT/dsh-codex-audit.sarif"
  step "Gates (log: $LOG)"
  gates
  exit 0
fi

[ -n "$VERSION" ] || usage
TAG="v$VERSION"
OUT="$TMP_ROOT/dsh-codex-release-$VERSION"
mkdir -p "$OUT"
LOG="$OUT/gates.log"; : >"$LOG"
SARIF="$OUT/audit.sarif"

step "1. Preconditions"
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "not a semver X.Y.Z: $VERSION"
[ "$(git branch --show-current)" = "$BRANCH" ] || die "not on $BRANCH"
[ -z "$(git status --porcelain)" ] || die "working tree is not clean"
git fetch --quiet origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] || die "$BRANCH differs from origin/$BRANCH"
! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || die "tag $TAG exists locally"
! git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null || die "tag $TAG exists on origin"
echo "  $BRANCH at $(git rev-parse --short HEAD), clean, in sync; $TAG is free"

step "2. Version and notes"
[ "$(node -p "require('./package.json').version")" = "$VERSION" ] || die "package.json is not $VERSION"
# package.json, both package-lock.json fields and the app-server clientInfo.
node scripts/verify-version-sync.mjs --tag "$TAG" || die "version surfaces disagree"
grep -Eq "^## \[$VERSION\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md || die "CHANGELOG.md has no dated '## [$VERSION] - YYYY-MM-DD' heading"
[ "$(git log -1 --format=%s)" = "chore: release v$VERSION" ] || die "HEAD is not 'chore: release v$VERSION'"
echo "  package.json, lockfile, clientInfo, CHANGELOG.md and HEAD say $VERSION"

step "3. Gates (log: $LOG)"
gates

step "4. Linux run ($LINUX_IMAGE, log: $OUT/linux.log)"
if linux_gates >"$OUT/linux.log" 2>&1; then
  grep -E '^  (suite|coverage)' "$OUT/linux.log" | sed 's/^ */  linux /' || true
else
  tail -n 40 "$OUT/linux.log"; die "Linux gate failed"
fi

step "5. Build and smoke"
run "npm pack + import smoke" pack_smoke

if [ "$DRY_RUN" = 1 ]; then
  step "Dry run: would now"
  echo "  git tag -s $TAG -m 'Release $TAG'   # SSH-signed, on $(git rev-parse --short HEAD)"
  echo "  git push origin $BRANCH"
  echo "  git push origin refs/tags/$TAG"
  echo "  gh run watch <publish.yml run for $TAG>; npm view $PKG@$VERSION; gh release view $TAG"
  exit 0
fi

step "6. Tag and push"
git tag -s "$TAG" -m "Release $TAG"
[ "$(git rev-list -n 1 "$TAG")" = "$(git rev-parse HEAD)" ] || die "$TAG does not point at HEAD"
[ "$(git log -1 --format=%s "$TAG")" = "chore: release v$VERSION" ] || die "$TAG is not on the release commit"
git push origin "$BRANCH"
git push origin "refs/tags/$TAG"

step "7. Watch publish"
watch_publish "$VERSION" "$TAG"
