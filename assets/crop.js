// Floriqa — crop a photo to the platform frame before upload (uses Cropper.js)
(function () {
  const CSS = "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css";
  const JS = "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js";
  let ready = null;
  const load = () => ready ||= new Promise((res, rej) => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = CSS; document.head.appendChild(l);
    const s = document.createElement("script"); s.src = JS; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });

  // aspect: 1 = square. Returns a File (JPEG) or null if cancelled.
  window.Floriqa.cropImage = async function (file, { aspect = 1, title = "Crop the photo", maxSize = 1400 } = {}) {
    if (!file || !file.type.startsWith("image/")) return file;
    await load();
    const url = URL.createObjectURL(file);
    return new Promise((resolve) => {
      const box = document.createElement("div");
      box.className = "card modal";
      box.style.cssText = "display:flex;flex-direction:column;gap:.8rem";
      box.innerHTML = `
        <div class="toolbar" style="margin:0"><h3 class="grow">${title}</h3></div>
        <p class="muted" style="margin:0">Drag to move · scroll or pinch to zoom · the frame is the exact shape shown on floriqa.xyz</p>
        <div style="flex:1;min-height:0;background:rgba(0,0,0,.4);border-radius:10px;overflow:hidden"><img src="${url}" style="display:block;max-width:100%"></div>
        <div class="toolbar" style="margin:0">
          <button class="btn small" data-z="0.1">Zoom +</button><button class="btn small" data-z="-0.1">Zoom −</button>
          <button class="btn small" data-r="90">Rotate</button><button class="btn small" data-reset>Reset</button>
          <span class="grow"></span>
          <button class="btn" data-cancel>Cancel</button><button class="btn primary" data-ok>Use this crop</button>
        </div>`;
      document.body.appendChild(box);
      const img = box.querySelector("img");
      const cropper = new window.Cropper(img, {
        aspectRatio: aspect, viewMode: 1, dragMode: "move", autoCropArea: 1,
        background: false, guides: false, center: true, cropBoxMovable: false, cropBoxResizable: false, toggleDragModeOnDblclick: false,
      });
      const done = (val) => { cropper.destroy(); box.remove(); URL.revokeObjectURL(url); resolve(val); };
      box.querySelectorAll("[data-z]").forEach((b) => b.onclick = () => cropper.zoom(+b.dataset.z));
      box.querySelector("[data-r]").onclick = () => cropper.rotate(90);
      box.querySelector("[data-reset]").onclick = () => cropper.reset();
      box.querySelector("[data-cancel]").onclick = () => done(null);
      box.querySelector("[data-ok]").onclick = () => {
        const w = aspect >= 1 ? maxSize : Math.round(maxSize * aspect);
        const h = Math.round(w / aspect);
        cropper.getCroppedCanvas({ width: w, height: h, imageSmoothingQuality: "high", fillColor: "#000" }).toBlob((blob) => {
          const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          done(blob ? new File([blob], name, { type: "image/jpeg" }) : null);
        }, "image/jpeg", 0.88);
      };
    });
  };
})();
