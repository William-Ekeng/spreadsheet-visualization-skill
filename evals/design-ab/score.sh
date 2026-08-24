#!/usr/bin/env bash
# Score a composed app.html against the countable checks in rubric.md.
# Usage: ./score.sh runs/round-3/arm-a/app.html [more.html ...]
# Output is one block per file, so two arms can be diffed side by side.

set -u

score_one() {
  local f="$1"
  [ -f "$f" ] || { echo "$f: not found"; return 1; }
  local style; style=$(sed -n '/<style/,/<\/style>/p' "$f")

  echo "=== $f ==="
  printf "  raw hex colors          %s   (want 0)\n"  "$(grep -aoE '#[0-9a-fA-F]{3,8}\b' "$f" | grep -v href | sort -u | wc -l)"
  printf "  declared font-sizes     %s   (want 0-3)\n" "$(grep -aoE 'font-size: *[^;]*' "$f" | sort -u | wc -l)"
  printf "  font-family decls       %s   (want 0)\n"  "$(grep -ac 'font-family' "$f")"
  printf "  inline style= attrs     %s   (want 0)\n"  "$(grep -aoE 'style=\"[^\"]*\"' "$f" | wc -l)"
  printf "  hardcoded px in <style> %s   (fewer is better)\n" "$(printf '%s' "$style" | grep -aoE '[0-9]+px' | sort -u | wc -l)"
  printf "  ss-panel count          %s   (watch for panel fever)\n" "$(grep -ac 'ss-panel' "$f")"
  printf "  StatusDot present       %s   (want 1)\n"  "$(grep -ac 'StatusDot' "$f")"
  printf "  ChartBlock used         %s   (want >=1 when data supports it)\n" "$(grep -ac 'ChartBlock(' "$f")"
  printf "  position:sticky         %s   (want 0-1)\n" "$(grep -ac 'position: *sticky' "$f")"
  printf "  scroll/entrance anim    %s   (want 0)\n"  "$(grep -aciE 'IntersectionObserver|animation:|fade-?in' "$f")"
  printf "  clickable divs          %s   (want 0)\n"  "$(grep -acE '<div[^>]*onclick' "$f")"
  printf "  explicit editable       %s   (want >=1: a decision, not the default)\n" "$(grep -ac 'editable:' "$f")"
  printf "  custom buttons          %s   (tool affordances beyond the kit)\n" "$(grep -aoE '>[^<>]{2,30}</button>' "$f" | wc -l)"
  printf "  custom store writes     %s   (store.saveCell/addRow/deleteRow)\n" "$(grep -ac 'store\.saveCell\|store\.addRow\|store\.deleteRow' "$f")"
  printf "  orientation prose       %s   (want >0: how editing works)\n" "$(grep -aoE '>[^<>]{60,}<' "$f" | wc -l)"
  printf "  total lines             %s\n" "$(wc -l < "$f")"
  echo
}

[ $# -eq 0 ] && { echo "usage: $0 <app.html> [...]"; exit 1; }
for f in "$@"; do score_one "$f"; done

cat <<'NOTE'
Checks this script cannot make (look at the rendered page):
  - does a row click open the detail panel WITHOUT scrolling (beside, not below)
  - is every visible string in the data's language
  - does the page support a real task, or only display numbers
  - does the data lead the first screen, or does chrome
NOTE
