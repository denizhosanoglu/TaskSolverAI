function extractExercise() {
  const selector = ".blank-slot[data-blank-id]";
  const blanks = [...document.querySelectorAll(selector)];
  const bank = [...document.querySelectorAll("#wordBankContainer .bank-item[data-bank-id]")];
  if (!blanks.length || !bank.length) return null;

  const rows = [...new Set(blanks.map(blank => blank.parentElement))];
  return {
    ids: rows.flatMap(row => [...row.querySelectorAll(selector)].map(blank => blank.dataset.blankId)),
    exercise: {
      sentences: rows.map(row => {
        const copy = row.cloneNode(true);
        copy.querySelectorAll(selector).forEach(blank => blank.replaceWith("___"));
        return copy.textContent.replace(/\s+/g, " ").trim();
      }),
      word_bank: bank.map(item => item.textContent.trim()),
      allow_reuse: false
    }
  };
}

async function placeAnswers(ids, words) {
  const blank = id => document.querySelector(
    '.blank-slot[data-blank-id="' + CSS.escape(id) + '"]'
  );
  for (const [index, id] of ids.entries()) {
    const slot = blank(id);
    if (!slot || (slot.textContent.trim() && slot.textContent.trim() !== words[index])) {
      throw new Error("Boşluklar değişmiş veya farklı cevap içeriyor. Egzersizi sıfırlayıp tekrar dene.");
    }
  }

  for (const [index, id] of ids.entries()) {
    const word = words[index];
    if (blank(id).textContent.trim() === word) continue;
    const items = document.querySelectorAll(
      "#wordBankContainer .bank-item[data-bank-id]:not(.used-up)"
    );
    const item = [...items].find(entry => entry.textContent.trim() === word);
    if (!item) return { error: "Havuzda kalan kelime bulunamadı: " + word };
    item.click();
    blank(id)?.click();
    const deadline = Date.now() + 1500;
    while (blank(id)?.textContent.trim() !== word && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (blank(id)?.textContent.trim() !== word) {
      return { error: "Site yerleştirmeyi onaylamadı: " + word };
    }
  }
  return { count: ids.length };
}

const button = document.querySelector("#solve");
const status = document.querySelector("#status");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Egzersiz okunuyor…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith("https://script.google.com/")) {
      throw new Error("Google Apps Script egzersiz sekmesini aç.");
    }
    const frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: extractExercise
    });
    const matches = frames.filter(frame => frame.result);
    if (matches.length !== 1) {
      throw new Error("Tek bir egzersiz bulunamadı. Soruların görünür olduğunu kontrol et.");
    }
    const { frameId, documentId, result: { exercise, ids } } = matches[0];
    status.textContent = "Gemini cevapları hazırlıyor. Bu pencereyi açık tut.";
    const { geminiKey } = await chrome.storage.local.get("geminiKey");
    if (!geminiKey) throw new Error("Önce Gemini API anahtarını kaydet.");
    const words = await solveWithGemini(exercise, ids.length, geminiKey, model => {
      status.textContent = model + " deneniyor… Pencereyi açık tut.";
    });
    if (words.length !== ids.length || new Set(ids).size !== ids.length) {
      throw new Error("Cevaplarla boşluklar eşleşmedi.");
    }

    status.textContent = "Cevaplar yerleştiriliyor…";
    const target = documentId ? { tabId: tab.id, documentIds: [documentId] }
                              : { tabId: tab.id, frameIds: [frameId] };
    const [placement] = await chrome.scripting.executeScript({
      target, func: placeAnswers, args: [ids, words]
    });
    if (!placement?.result?.count) {
      throw new Error(placement?.result?.error ?? "Sayfaya cevap yazılamadı.");
    }
    status.textContent = placement.result.count + " boşluk dolduruldu.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#save").addEventListener("click", async () => {
  const input = document.querySelector("#key");
  const geminiKey = input.value.trim();
  if (!geminiKey) {
    status.textContent = "Gemini API anahtarını gir.";
    return;
  }
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    await chrome.storage.local.set({ geminiKey });
    input.value = "";
    status.textContent = "Gemini API anahtarı kaydedildi.";
  } catch (error) {
    status.textContent = error.message;
  }
});
