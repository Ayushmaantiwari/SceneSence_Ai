const $ = (id) => document.getElementById(id);
const input = $("fileInput"), zone = $("dropZone"), preview = $("preview"), previewState = $("previewState"), emptyState = $("emptyState"), analyzeButton = $("analyzeButton");
const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);
const samples = {
  street: ["Urban Street", "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1200&q=82"],
  nature: ["Nature Mist", "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1200&q=82"],
  city: ["Neon City", "https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=1200&q=82"],
  gallery: ["Art Gallery", "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=1200&q=82"],
};
let selectedFile = null, previewUrl = null, lastResult = null, serverReady = false;
function showError(message) { $("errorBanner").textContent = message; $("errorBanner").hidden = false; }
function hideError() { $("errorBanner").hidden = true; $("errorBanner").textContent = ""; }
function updateButton() { analyzeButton.disabled = !selectedFile || !serverReady; }
function setStep(active) { [1, 2, 3].forEach((n) => { $(`step${n}`).classList.toggle("active", n === active); $(`step${n}`).classList.toggle("done", n < active); }); }
function revokePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; preview.removeAttribute("src"); }
function setFile(file, sampleButton = null) {
  if (!file) return;
  hideError(); $("results").hidden = true;
  if (!allowed.has(file.type)) return showError("Choose a JPEG, PNG, WebP, GIF, or BMP image.");
  if (!file.size) return showError("That file is empty. Choose another image.");
  if (file.size > 10 * 1024 * 1024) return showError("This image exceeds the 10 MB upload limit.");
  selectedFile = null; updateButton(); revokePreview(); previewUrl = URL.createObjectURL(file); const current = previewUrl;
  preview.onload = () => {
    if (previewUrl !== current) return;
    selectedFile = file;
    const type = (file.type.split("/")[1] || "IMAGE").toUpperCase().replace("JPEG", "JPG");
    $("imageMeta").textContent = `${file.name} · ${preview.naturalWidth} × ${preview.naturalHeight} · ${type} · ${(file.size / 1048576).toFixed(2)} MB`;
    previewState.hidden = false; emptyState.hidden = true;
    document.querySelectorAll(".sample").forEach((item) => item.classList.toggle("selected", item === sampleButton));
    $("connectionStatus").textContent = serverReady ? "Server connected · Image ready" : "Image ready · Waiting for server";
    setStep(2); updateButton();
  };
  preview.onerror = () => { if (previewUrl === current) { selectedFile = null; updateButton(); showError("This image could not be previewed. Try saving it as JPG or PNG and upload it again."); } };
  preview.src = previewUrl;
}
function clearFile() {
  selectedFile = null; input.value = ""; revokePreview(); previewState.hidden = true; emptyState.hidden = false; $("results").hidden = true;
  $("scanOverlay").hidden = true; document.querySelectorAll(".sample").forEach((item) => item.classList.remove("selected"));
  hideError(); setStep(1); updateButton(); $("connectionStatus").textContent = serverReady ? "Server connected · Ready when you are" : "Start the server to analyze images";
}
$("browseButton").addEventListener("click", (event) => { event.stopPropagation(); input.click(); });
zone.addEventListener("click", (event) => { if (emptyState.contains(event.target) && !event.target.closest("button")) input.click(); });
zone.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key) && previewState.hidden && (event.target === zone || emptyState.contains(event.target))) { event.preventDefault(); input.click(); } });
input.addEventListener("change", () => { const file = input.files?.[0]; input.value = ""; setFile(file); });
$("removeButton").addEventListener("click", clearFile);
["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add("dragover"); }));
["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove("dragover"); }));
zone.addEventListener("drop", (event) => setFile(event.dataTransfer.files?.[0]));
$("sampleGrid").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-sample]"); if (!button) return;
  const [name, url] = samples[button.dataset.sample]; button.disabled = true; hideError(); $("connectionStatus").textContent = `Loading ${name} sample…`;
  try {
    const response = await fetch(url); if (!response.ok) throw new Error("Could not download the sample image.");
    const blob = await response.blob(); if (!blob.type.startsWith("image/")) throw new Error("The sample source did not return an image.");
    const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    setFile(new File([blob], `${name.toLowerCase().replaceAll(" ", "-")}.${ext}`, { type: blob.type }), button);
  } catch (error) { showError(`${error.message} Check your internet connection or upload a photo from your device.`); $("connectionStatus").textContent = "Sample could not be loaded"; }
  finally { button.disabled = false; }
});
function escapeHtml(text) { return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function render(data, time) {
  const objects = Array.isArray(data.objects) ? data.objects : [], rels = Array.isArray(data.relationships) ? data.relationships : [], acts = Array.isArray(data.activities) ? data.activities : [];
  $("summary").textContent = data.summary || "No scene summary returned."; $("context").textContent = data.context || "No additional context identified.";
  $("resultWarning").textContent = data.warning || ""; $("resultWarning").hidden = !data.warning; $("objectCount").textContent = `(${objects.length})`;
  $("objects").innerHTML = objects.length ? objects.map((item) => {
    const attrs = item.attributes && typeof item.attributes === "object" ? Object.values(item.attributes).filter(Boolean).join(" · ") : "";
    return `<div class="object-item"><b>${escapeHtml(item.name || "Object")}</b><small>${escapeHtml([item.location, attrs].filter(Boolean).join(" · ") || "No extra details")}</small></div>`;
  }).join("") : '<span class="empty-note">No clear objects identified.</span>';
  $("relationships").innerHTML = rels.length ? rels.map((r) => `<div>${escapeHtml(r.subject)} <b>${escapeHtml(r.relation)}</b> ${escapeHtml(r.object)}</div>`).join("") : '<span class="empty-note">No clear relationships identified.</span>';
  $("activities").innerHTML = acts.length ? acts.map((a) => `<div>${escapeHtml(a)}</div>`).join("") : '<span class="empty-note">No distinct activities identified.</span>';
  $("jsonOutput").textContent = JSON.stringify(data, null, 2); $("resultMeta").textContent = `${data.model || "Vision model"} · ${(time / 1000).toFixed(1)} s`; lastResult = data;
}
analyzeButton.addEventListener("click", async () => {
  if (!selectedFile || !serverReady) return;
  hideError(); $("results").hidden = true; analyzeButton.disabled = true; analyzeButton.innerHTML = '<span>Analyzing…</span><i class="spinner"></i>';
  $("scanOverlay").hidden = false; $("connectionStatus").textContent = "Vision model is analyzing the image…"; setStep(2); const started = performance.now();
  try {
    const form = new FormData(); form.append("file", selectedFile, selectedFile.name);
    const response = await fetch("/api/analyze", { method: "POST", body: form }); const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `The server returned error ${response.status}.`);
    render(data, performance.now() - started); $("results").hidden = false; $("connectionStatus").textContent = "Analysis complete · Results ready"; setStep(3);
    $("results").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    showError(error instanceof TypeError ? "Could not reach the SceneSense server. Start it with ‘uvicorn app.main:app --reload’." : error.message);
    $("connectionStatus").textContent = "Analysis could not be completed"; setStep(2);
  } finally { $("scanOverlay").hidden = true; analyzeButton.innerHTML = '<span>Analyze scene</span><i>↗</i>'; updateButton(); }
});
$("copyButton").addEventListener("click", async () => {
  if (!lastResult) return;
  try { await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2)); $("copyButton").textContent = "Copied"; setTimeout(() => { $("copyButton").textContent = "Copy JSON"; }, 1300); }
  catch { showError("Clipboard access is unavailable. Open View structured JSON and copy it there."); }
});
if (localStorage.getItem("scenesense-theme") === "light") document.documentElement.dataset.theme = "light";
function setThemeIcon() { const light = document.documentElement.dataset.theme === "light"; $("themeToggle").textContent = light ? "☀" : "☾"; $("themeToggle").setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme"); }
setThemeIcon(); $("themeToggle").addEventListener("click", () => { const theme = document.documentElement.dataset.theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = theme; localStorage.setItem("scenesense-theme", theme); setThemeIcon(); });
async function checkHealth() {
  try {
    const response = await fetch("/api/health"); if (!response.ok) throw new Error("Backend is offline"); const health = await response.json();
    const names = { openrouter: "OPENROUTER", hf_api: "HUGGING FACE", transformers: "LOCAL INFERENCE" };
    serverReady = Boolean(health.configured); $("providerLabel").textContent = names[health.provider] || String(health.provider).toUpperCase(); $("modelLabel").textContent = health.model || "Vision model";
    ["healthDot", "connectionDot"].forEach((id) => { $(id).classList.toggle("online", serverReady); $(id).classList.toggle("offline", !serverReady); });
    if (health.provider === "transformers") { $("privacyTitle").textContent = "Your images stay on this device"; $("privacyText").textContent = "The configured local model processes images on this computer."; }
    else { $("privacyTitle").textContent = "Image sent for analysis"; $("privacyText").textContent = "The configured provider receives the image for analysis. SceneSense does not save uploads."; }
    $("connectionStatus").textContent = serverReady ? "Server connected · Ready when you are" : `Configure ${health.provider === "openrouter" ? "OPENROUTER_API_KEY" : "HF_TOKEN"} in .env`;
  } catch { serverReady = false; $("providerLabel").textContent = "SERVER OFFLINE"; $("modelLabel").textContent = "Start the backend"; $("healthDot").classList.add("offline"); $("connectionDot").classList.add("offline"); $("connectionStatus").textContent = "Start the SceneSense server to analyze images"; }
  updateButton();
}
checkHealth();
