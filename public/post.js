
const form = document.getElementById('post-form');
const photoInput = document.getElementById('photo');
const submitButton = document.getElementById('submit-button');
const message = document.getElementById('form-message');


// Messages
// type is 'success' or 'error'
function showMessage(type, text, link) {
  message.textContent = text;
  message.className = `form-message ${type}`;
  if (link) message.append(' ', link);
  message.hidden = false;
}

function hideMessage() {
  message.hidden = true;
  message.textContent = '';
}

//Submit
async function handleSubmit(event) {
  //Stop the browser's default form submit so it doesn't reload the page
  event.preventDefault();
  hideMessage();


  //Prevent double clicking posting the item twice
  submitButton.disabled = true;
  submitButton.textContent = 'Posting…';

  try {
    const response = await fetch('/api/items', { method: 'POST', body: new FormData(form) });
    //On errors the server sends { error: '...' }, on success it sends the new item (201).
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      showMessage('error', `Could not post your item: ${data.error || 'please try again.'}`);
      return;
    }

    form.reset(); //clears text fields and the chosen photo
    const homeLink = document.createElement('a');
    homeLink.href = '/';
    homeLink.textContent = 'See it on the homepage →';
    showMessage('success', `Thanks! “${data.title}” was posted.`, homeLink);
  } catch (error) {    //fetch only throws when the request never gets an answer

    showMessage('error', 'Could not reach the server. Check your connection and try again.');
  } finally {
    //Runs after success, error response, network failure.
    submitButton.disabled = false;
    submitButton.textContent = 'Post item';
  }
}

form.addEventListener('submit', handleSubmit);