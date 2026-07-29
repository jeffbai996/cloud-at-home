// Rolling-digit time paint adapted from the suite's music-style play clock.
// Each digit lives in a fixed inline-grid
// cell; on change the old glyph slides up and out while the new one rises in
// from below (CSS drives the motion via the .rolling class). Non-digit marks
// (":" here) are plain cells rewritten in place.
//
// The DOM inside the host element is owned by THIS function, not React — the
// host renders once as an empty span and every update goes through here, so
// React reconciliation never fights the mid-roll markup.

const ROLL_CLEANUP_MS = 360; // slightly past the .32s CSS transition

type RollCell = HTMLSpanElement & { rollTimer?: number; dataset: DOMStringMap };

export function paintRollingTime(element: HTMLElement, value: string): void {
  element.setAttribute("aria-label", value);
  if (element.children.length !== value.length) {
    // Rebuild on length change (0:59 -> 1:00:00 after a seek), but keep the
    // cells that still line up so the roll below can run on them. Aligned
    // from the RIGHT, because that is how place value works.
    const old = [...element.children] as RollCell[];
    const shift = old.length - value.length;
    element.innerHTML = "";
    [...value].forEach((character, index) => {
      const previous = old[index + shift];
      let cell: RollCell;
      // reuse only a like-for-like cell, or the roll has nothing to turn from
      if (previous && /\d/.test(character) && previous.classList.contains("time-wheel-digit")) {
        cell = previous;
        cell.classList.remove("rolling");
        window.clearTimeout(cell.rollTimer);
        cell.innerHTML = `<span class="time-wheel-face">${cell.dataset.value}</span>`;
      } else {
        cell = document.createElement("span");
        cell.setAttribute("aria-hidden", "true");
        if (/\d/.test(character)) {
          cell.className = "time-wheel-digit";
          cell.dataset.value = character;
          cell.innerHTML = `<span class="time-wheel-face">${character}</span>`;
        } else {
          cell.className = "time-wheel-mark";
          cell.textContent = character;
        }
      }
      element.appendChild(cell);
    });
    // fall through: the loop below rolls whichever reused digits changed
  }
  [...value].forEach((character, index) => {
    const cell = element.children[index] as RollCell;
    if (!/\d/.test(character)) {
      if (cell.textContent !== character) cell.textContent = character;
      return;
    }
    if (cell.dataset.value === character) return;
    const previous = cell.dataset.value;
    cell.dataset.value = character;
    window.clearTimeout(cell.rollTimer);
    cell.classList.remove("rolling");
    // NO whitespace between these spans: the cell is an inline-grid, so an
    // anonymous text item would take a grid cell of its own and nudge the
    // digit off the baseline.
    cell.innerHTML =
      `<span class="time-wheel-old">${previous}</span>` +
      `<span class="time-wheel-new">${character}</span>`;
    void cell.offsetHeight;
    cell.classList.add("rolling");
    cell.rollTimer = window.setTimeout(() => {
      if (cell.dataset.value !== character) return;
      cell.classList.remove("rolling");
      cell.innerHTML = `<span class="time-wheel-face">${character}</span>`;
    }, ROLL_CLEANUP_MS);
  });
}
