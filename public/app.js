/* HOMEPAGE ELEMENTS */
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search');
const clearButton = document.getElementById('clear-search');
const retryButton = document.getElementById('retry');
const results = document.getElementById('results');
const grid = document.getElementById('item-grid');
const summary = document.getElementById('results-summary');
const statePanel = document.getElementById('state-panel');
const stateMessage = document.getElementById('state-message');
let debounceTimer;
let requestNumber = 0;
let activeController;

/* SAFE ITEM RENDERING */
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showPhotoPlaceholder(container) {
  container.replaceChildren(
    element('span', 'placeholder-symbol', '◇'),
    element('span', 'placeholder-label', 'No photo available')
  );
  container.firstChild.setAttribute('aria-hidden', 'true');
}

function createItemCard(item) {
  const card = element('article', 'item-card');
  const photo = element('div', 'item-photo');
  showPhotoPlaceholder(photo);
  // Only use the upload paths served by our backend, never arbitrary URLs.
  if (typeof item.photo_path === 'string' && /^\/uploads\/[\w.-]+\.(jpg|jpeg|png|gif|webp)$/i.test(item.photo_path)) {
    const image = document.createElement('img');
    image.alt = `Photo of ${item.title}`;
    image.loading = 'lazy';
    image.addEventListener('error', () => showPhotoPlaceholder(photo), { once: true });
    image.src = item.photo_path;
    photo.replaceChildren(image);
  }
  const content = element('div', 'item-content');
  if (item.created_at) {
    // SQLite datetime('now') is UTC, although its value has no timezone suffix.
    const rawDate = String(item.created_at);
    const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawDate) ? rawDate.replace(' ', 'T') + 'Z' : rawDate);
    if (!Number.isNaN(date.getTime())) {
      const time = element('time', 'item-date', `Posted ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`);
      time.dateTime = date.toISOString();
      content.append(time);
    }
  }
  content.append(element('h3', '', item.title), element('p', 'item-description', item.description));
  content.append(element('p', 'item-location', item.location_found ? `Found at ${item.location_found}` : 'Location not provided'));
  const claimLink = element('a', 'button claim-button', 'Claim this item →');
  claimLink.href = `/claim.html?id=${encodeURIComponent(item.id)}`;
  claimLink.setAttribute('aria-label', `Claim ${item.title}`);
  content.append(claimLink);
  card.append(photo, content);
  return card;
}

/* API AND RESULT STATES */
async function loadItems() {
  clearTimeout(debounceTimer);
  const currentRequest = ++requestNumber;
  activeController?.abort();
  activeController = new AbortController();
  const query = searchInput.value.trim();
  clearButton.hidden = searchInput.value.length === 0;
  grid.replaceChildren();
  results.setAttribute('aria-busy', 'true');
  statePanel.hidden = false;
  retryButton.hidden = true;
  stateMessage.textContent = 'Loading found items...';
  summary.textContent = 'Loading found items...';
  try {
    const response = await fetch(`/api/items${query ? `?q=${encodeURIComponent(query)}` : ''}`, { signal: activeController.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Item request failed');
    const items = await response.json();
    if (!Array.isArray(items)) throw new Error('Invalid item response');
    if (currentRequest !== requestNumber) return;
    grid.replaceChildren(...items.map(createItemCard));
    statePanel.hidden = items.length > 0;
    stateMessage.textContent = query ? 'No items match your search.' : 'No items have been posted yet.';
    summary.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'} ${query ? `matching “${query}”` : 'available to claim'}`;
  } catch (error) {
    if (currentRequest !== requestNumber || error.name === 'AbortError') return;
    statePanel.hidden = false;
    stateMessage.textContent = 'Unable to load items. Please try again.';
    summary.textContent = 'Items could not be loaded.';
    retryButton.hidden = false;
  } finally {
    if (currentRequest === requestNumber) results.setAttribute('aria-busy', 'false');
  }
}

/* SEARCH AND NAVIGATION EVENTS */
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  // Invalidate immediately so an earlier response cannot win during the debounce.
  requestNumber++;
  activeController?.abort();
  clearButton.hidden = searchInput.value.length === 0;
  debounceTimer = setTimeout(loadItems, 250);
});
searchForm.addEventListener('submit', event => {
  event.preventDefault();
  loadItems();
});
clearButton.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.focus();
  loadItems();
});
retryButton.addEventListener('click', loadItems);
// Refresh after returning from the claim page, including browser back/forward cache.
window.addEventListener('pageshow', loadItems);
