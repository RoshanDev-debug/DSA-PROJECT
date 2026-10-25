/* ArrayX – Interactive Array Visualizer
   script.js

   How it works:
   - "arr" is a real JavaScript array. Every operation changes it step by step.
   - After each step, render() redraws the boxes from the current contents of "arr".
   - The screen never decides the result. The array does.
*/
'use strict';

/* ---------- Settings ---------- */
const INITIAL_ARRAY = [10, 20, 30, 40, 50];
const MAX_SIZE = 10;        // keeps the layout tidy
const MIN_VALUE = -999;
const MAX_VALUE = 999;
const STEP_DELAY = 500;     // milliseconds between animation steps

/* ---------- State ---------- */
let arr = [...INITIAL_ARRAY]; // a copy, so INITIAL_ARRAY itself never changes
let busy = false;             // true while an operation is running
let focusBefore = null;       // remembers which element had focus
let toastTimer = null;

/* ---------- Page elements ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  array: $('array'),
  emptyNote: $('empty-note'),
  arrayText: $('array-text'),
  lengthChip: $('length-chip'),
  step: $('step'),
  opName: $('op-name'),
  opText: $('op-text'),
  opTime: $('op-time'),
  opDetail: $('op-detail'),
  insertValue: $('insert-value'),
  insertIndex: $('insert-index'),
  deleteIndex: $('delete-index'),
  updateValue: $('update-value'),
  updateIndex: $('update-index'),
  searchValue: $('search-value'),
  toast: $('toast'),
};

/* =========================================================
   Drawing
   ========================================================= */

/* Draws the array as boxes.
   "marks" says which index gets which highlight, e.g. { 2: 'checking' }.
   A null element is an empty slot (used while making room for an insert). */
function render(marks = {}) {
  els.array.innerHTML = '';

  arr.forEach((value, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    if (value === null) slot.classList.add('empty');
    if (marks[i]) slot.classList.add(marks[i]);
    slot.setAttribute('role', 'listitem');
    slot.setAttribute('aria-label', value === null ? `Index ${i}, empty` : `Index ${i}, value ${value}`);

    const box = document.createElement('div');
    box.className = 'box';
    box.textContent = value === null ? '' : value;

    const idx = document.createElement('div');
    idx.className = 'idx';
    idx.textContent = i;

    slot.append(box, idx);
    els.array.appendChild(slot);
  });

  els.emptyNote.hidden = arr.length !== 0;
  els.arrayText.textContent = 'arr = [' + arr.map((v) => (v === null ? '_' : v)).join(', ') + ']';
  els.lengthChip.textContent = `Length ${arr.length} of ${MAX_SIZE}`;
}

/* Updates the "Current operation" panel. */
function setInfo(name, text, time, detail) {
  els.opName.textContent = name;
  els.opText.textContent = text;
  els.opTime.textContent = time;
  els.opDetail.textContent = detail;
}

function setStep(text) {
  els.step.textContent = text;
}

/* Shows the valid index range under each Index field. */
function updateHints() {
  const n = arr.length;
  document.querySelectorAll('[data-hint="insert"]').forEach((h) => {
    h.textContent = `(0 to ${n})`;            // inserting at index n means "add at the end"
  });
  document.querySelectorAll('[data-hint="other"]').forEach((h) => {
    h.textContent = n === 0 ? '(array is empty)' : `(0 to ${n - 1})`;
  });
}

/* Friendly message at the bottom of the screen. type: 'error' | 'success' | 'info' */
function showToast(message, type) {
  els.toast.textContent = message;
  els.toast.className = 'toast ' + type;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4500);
}

/* =========================================================
   Input checking
   ========================================================= */

/* Shows an error, marks the field red and returns null. */
function fail(message, input) {
  if (input) input.classList.add('invalid');
  showToast(message, 'error');
  return null;
}

/* Reads a whole number from an input. Returns the number, or null if it is invalid. */
function readValue(input) {
  const text = input.value.trim();
  if (!/^-?\d+$/.test(text)) {
    return fail('Please enter a whole number, like 25 or -7.', input);
  }
  const n = parseInt(text, 10);
  if (n < MIN_VALUE || n > MAX_VALUE) {
    return fail(`Please use a value between ${MIN_VALUE} and ${MAX_VALUE}.`, input);
  }
  return n;
}

/* Reads an index from an input. It must be a whole number from 0 to maxIndex. */
function readIndex(input, maxIndex) {
  const text = input.value.trim();
  if (/^-\d+$/.test(text)) {
    return fail('An index cannot be negative. The first index is 0.', input);
  }
  if (!/^\d+$/.test(text)) {
    return fail('Please enter an index as a whole number, like 0, 1 or 2.', input);
  }
  const n = parseInt(text, 10);
  if (n > maxIndex) {
    return fail(`Index ${n} is out of range. Choose an index from 0 to ${maxIndex}.`, input);
  }
  return n;
}

function clearInvalid() {
  document.querySelectorAll('input.invalid').forEach((i) => i.classList.remove('invalid'));
}

/* =========================================================
   Helpers for running operations safely
   ========================================================= */

const sleep = (ms = STEP_DELAY) => new Promise((resolve) => setTimeout(resolve, ms));

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* Disables every button and field while an animation plays. */
function lockControls() {
  focusBefore = document.activeElement;
  document.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
}

function unlockControls() {
  document.querySelectorAll('button, input').forEach((el) => { el.disabled = false; });
  if (focusBefore && document.body.contains(focusBefore)) focusBefore.focus();
}

/* Every button goes through here. If something is already running, the click is ignored. */
async function runOperation(operation) {
  if (busy) return;
  busy = true;
  clearInvalid();
  els.toast.hidden = true;
  try {
    await operation();
  } finally {
    busy = false;
    unlockControls();
    updateHints();
  }
}

/* =========================================================
   Operations
   ========================================================= */

/* INSERT at an index.
   Steps: 1) add an empty slot at the end
          2) shift elements right, starting from the LAST one (so nothing is overwritten)
          3) put the new value at the chosen index
   Time: O(n) worst case, because many elements may have to move. */
async function insertValue() {
  if (arr.length >= MAX_SIZE) {
    return fail(`The array is full (maximum ${MAX_SIZE} elements). Delete one first.`);
  }
  const value = readValue(els.insertValue);
  if (value === null) return;
  const index = readIndex(els.insertIndex, arr.length); // index == length means "add at the end"
  if (index === null) return;

  const shifts = arr.length - index;
  setInfo(
    'Insert',
    `Insert ${value} at index ${index}. Every element from index ${index} onwards moves one place to the right to make room.`,
    'O(n)',
    shifts === 0 ? '0 shifts (added at the end, so O(1))' : plural(shifts, 'shift')
  );
  lockControls();

  arr.push(null);                                  // step 1: make room
  setStep('Step 1: add an empty slot at the end.');
  render();
  await sleep();

  for (let j = arr.length - 1; j > index; j--) {   // step 2: shift right
    arr[j] = arr[j - 1];
    setStep(`Step 2: arr[${j}] = arr[${j - 1}]  (${arr[j]} moves right)`);
    render({ [j]: 'shift-right', [j - 1]: 'source' });
    await sleep();
  }

  arr[index] = value;                              // step 3: place the value
  setStep(`Step 3: arr[${index}] = ${value}`);
  render({ [index]: 'inserted' });
  showToast(`Inserted ${value} at index ${index}.`, 'success');
}

/* DELETE at an index.
   Steps: 1) mark the element to remove
          2) shift every later element one place LEFT (this overwrites the removed one)
          3) remove the extra last slot with pop()
   Time: O(n) worst case (deleting index 0 moves everything). */
async function deleteValue() {
  if (arr.length === 0) {
    return fail('The array is empty. There is nothing to delete.');
  }
  const index = readIndex(els.deleteIndex, arr.length - 1);
  if (index === null) return;

  const removed = arr[index];
  const shifts = arr.length - 1 - index;
  setInfo(
    'Delete',
    `Delete ${removed} at index ${index}. Every element after it moves one place to the left to close the gap.`,
    'O(n)',
    shifts === 0 ? '0 shifts (last element, so O(1))' : plural(shifts, 'shift')
  );
  lockControls();

  setStep(`Step 1: remove ${removed} from index ${index}.`);
  render({ [index]: 'removing' });
  await sleep();

  for (let j = index; j < arr.length - 1; j++) {   // step 2: shift left
    arr[j] = arr[j + 1];
    setStep(`Step 2: arr[${j}] = arr[${j + 1}]  (${arr[j]} moves left)`);
    render({ [j]: 'shift-left', [j + 1]: 'source' });
    await sleep();
  }

  arr.pop();                                       // step 3: drop the extra last slot
  setStep('Step 3: remove the extra last slot.');
  render();
  showToast(`Deleted ${removed} from index ${index}.`, 'success');
}

/* UPDATE the element at an index.
   Direct access by index, so no shifting: O(1). */
async function updateValue() {
  if (arr.length === 0) {
    return fail('The array is empty. Insert a value first, then you can update it.');
  }
  const value = readValue(els.updateValue);
  if (value === null) return;
  const index = readIndex(els.updateIndex, arr.length - 1);
  if (index === null) return;

  const oldValue = arr[index];
  setInfo(
    'Update',
    `Replace the value at index ${index} with ${value}. An array can jump straight to any index, so nothing else moves.`,
    'O(1)',
    '1 write, no shifting'
  );
  lockControls();

  setStep(`Go straight to index ${index} (currently ${oldValue}).`);
  render({ [index]: 'checking' });
  await sleep();

  arr[index] = value;
  setStep(`arr[${index}] = ${value}`);
  render({ [index]: 'updated' });
  showToast(`Updated index ${index}: ${oldValue} is now ${value}.`, 'success');
}

/* LINEAR SEARCH.
   Check elements from index 0 onwards until the target is found or the array ends.
   With duplicate values it stops at the FIRST match.
   Time: O(n) worst case (target is last or missing). */
async function linearSearch() {
  if (arr.length === 0) {
    return fail('The array is empty. Insert a value first, then search.');
  }
  const target = readValue(els.searchValue);
  if (target === null) return;

  setInfo(
    'Linear search',
    `Look at each element from index 0, one by one, until ${target} is found or the array ends.`,
    'O(n)',
    'Searching...'
  );
  lockControls();

  const checked = {};                              // indexes already compared
  for (let i = 0; i < arr.length; i++) {
    setStep(`Compare arr[${i}] = ${arr[i]} with ${target}`);
    render({ ...checked, [i]: 'checking' });
    await sleep();

    if (arr[i] === target) {                       // found: stop at the first match
      render({ ...checked, [i]: 'found' });
      const copies = arr.filter((v) => v === target).length;
      els.opDetail.textContent = `Found after ${plural(i + 1, 'comparison')}`;
      setStep(`Match! arr[${i}] equals ${target}.`);
      showToast(
        copies > 1
          ? `Found ${target} at index ${i}. It appears ${copies} times; search stops at the first match.`
          : `Found ${target} at index ${i}.`,
        'success'
      );
      return;
    }
    checked[i] = 'checked';                        // not this one, move on
  }

  render(checked);                                 // reached the end without a match
  els.opDetail.textContent = `Not found after ${plural(arr.length, 'comparison')}`;
  setStep(`${target} is not in the array.`);
  showToast(`${target} was not found. All ${arr.length} elements were checked.`, 'info');
}

/* RESET: copy the starting array back in. */
async function resetArray() {
  arr = [...INITIAL_ARRAY];
  document.querySelectorAll('input').forEach((i) => { i.value = ''; });
  setInfo(
    'Reset',
    'The array is back to its starting values.',
    'O(n)',
    `${plural(arr.length, 'element')} copied`
  );
  setStep('');
  render();
  showToast('Array reset.', 'success');
}

/* =========================================================
   Connect buttons to operations
   ========================================================= */

const handlers = {
  insert: insertValue,
  delete: deleteValue,
  update: updateValue,
  search: linearSearch,
};

document.querySelectorAll('form.op').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();                        // stop the page from reloading
    runOperation(handlers[form.dataset.op]);
  });
});

$('reset-btn').addEventListener('click', () => runOperation(resetArray));

// Remove the red border as soon as the user starts fixing a field
document.querySelectorAll('input').forEach((input) => {
  input.addEventListener('input', () => input.classList.remove('invalid'));
});

/* ---------- Start ---------- */
render();
updateHints();
setInfo(
  'Ready',
  'Pick an operation below. An array stores elements side by side, so it can jump straight to any index.',
  'O(1)',
  'Access by index'
);
