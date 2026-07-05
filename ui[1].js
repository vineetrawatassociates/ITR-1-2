/* =========================================================================
   UI wiring — upload, render, print/PDF, Word export
   ========================================================================= */

const els = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  errorBox: document.getElementById("errorBox"),
  toolbar: document.getElementById("toolbar"),
  meta: document.getElementById("meta"),
  sheetWrap: document.getElementById("sheetWrap"),
  sheetContent: document.getElementById("sheet-content"),
  editHint: document.getElementById("editHint"),
  btnPrint: document.getElementById("btnPrint"),
  btnWord: document.getElementById("btnWord"),
  btnReset: document.getElementById("btnReset")
};

let currentModel = null;

function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.style.display = "block";
}

function clearError() {
  els.errorBox.style.display = "none";
  els.errorBox.textContent = "";
}

function handleFile(file) {
  clearError();
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    let json;
    try {
      json = JSON.parse(e.target.result);
    } catch (err) {
      showError("This file isn't valid JSON. Please upload the ITR e-filing JSON exported for this client.");
      return;
    }
    try {
      currentModel = detectAndParse(json);
      renderToScreen(currentModel);
    } catch (err) {
      showError(err.message || "Could not parse this ITR JSON.");
    }
  };
  reader.onerror = () => showError("Could not read the file. Please try again.");
  reader.readAsText(file);
}

function renderToScreen(model) {
  els.sheetContent.innerHTML = renderComputation(model);
  els.toolbar.style.display = "flex";
  els.editHint.style.display = "block";
  els.sheetWrap.style.display = "block";
  els.dropzone.style.display = "none";
  els.meta.textContent = `${model.itrFormName} · ${model.name || "—"} · PAN ${model.pan || "—"} · AY ${model.ay}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetTool() {
  currentModel = null;
  els.sheetContent.innerHTML = "";
  els.toolbar.style.display = "none";
  els.editHint.style.display = "none";
  els.sheetWrap.style.display = "none";
  els.dropzone.style.display = "block";
  els.fileInput.value = "";
  clearError();
}

/* ---------------- Drag & drop / picker wiring ---------------- */

els.fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

["dragenter", "dragover"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("drag");
  })
);
els.dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  handleFile(file);
});

els.btnPrint.addEventListener("click", () => window.print());
els.btnReset.addEventListener("click", resetTool);
els.btnWord.addEventListener("click", () => exportWord());

/* ---------------- Word export (generic DOM -> docx walker) ---------------- */

function cellText(node) {
  return (node.innerText || node.textContent || "").trim();
}

function buildDocxParagraphsFromLetterhead(div) {
  const name = div.querySelector(".firm-name");
  const lines = div.querySelectorAll(".firm-line");
  const { Paragraph, TextRun, AlignmentType } = docx;
  const paras = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: cellText(name), bold: true, size: 26 })]
    })
  ];
  lines.forEach((l) => {
    paras.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: cellText(l), size: 18 })]
      })
    );
  });
  return paras;
}

function buildDocxTitle(div) {
  const { Paragraph, TextRun, AlignmentType, UnderlineType } = docx;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 200 },
    children: [new TextRun({ text: cellText(div), bold: true, underline: { type: UnderlineType.SINGLE }, size: 22 })]
  });
}

function buildDocxSectionHead(div) {
  const { Paragraph, TextRun, ShadingType } = docx;
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: "EEF1F5" },
    spacing: { before: 220, after: 80 },
    children: [new TextRun({ text: cellText(div), bold: true, size: 20 })]
  });
}

function buildDocxInfoGrid(table) {
  const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle } = docx;
  const border = { style: BorderStyle.SINGLE, size: 2, color: "D8DDE5" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const rows = [];
  table.querySelectorAll("tr").forEach((tr) => {
    const cells = Array.from(tr.children);
    const tcells = cells.map((td, i) => {
      const isLabel = td.classList.contains("ik");
      const colSpan = td.getAttribute("colspan") ? parseInt(td.getAttribute("colspan"), 10) : 1;
      return new TableCell({
        borders,
        columnSpan: colSpan > 1 ? colSpan : undefined,
        width: { size: isLabel ? 16 : 34, type: WidthType.PERCENTAGE },
        shading: isLabel ? { fill: "FAFBFC" } : undefined,
        children: [new Paragraph({ children: [new TextRun({ text: cellText(td), bold: isLabel, size: 19 })] })]
      });
    });
    rows.push(new TableRow({ children: tcells }));
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function buildDocxCompTable(table) {
  const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, AlignmentType, BorderStyle } = docx;
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
  const topBorder = { style: BorderStyle.SINGLE, size: 6, color: "888888" };

  const hasHead = table.querySelector("thead");
  const rows = [];

  if (hasHead) {
    const ths = Array.from(hasHead.querySelectorAll("th"));
    rows.push(
      new TableRow({
        children: ths.map(
          (th) =>
            new TableCell({
              borders: { ...noBorders, bottom: { style: BorderStyle.SINGLE, size: 6, color: "444444" } },
              children: [
                new Paragraph({
                  alignment: th.classList.contains("amt") ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  children: [new TextRun({ text: cellText(th), bold: true, size: 19 })]
                })
              ]
            })
        )
      })
    );
  }

  table.querySelectorAll("tbody tr").forEach((tr) => {
    const isGrp = tr.classList.contains("grp");
    const isBold = tr.classList.contains("row-bold");
    const cells = Array.from(tr.children);

    if (isGrp) {
      const text = cellText(cells[0]);
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              borders: noBorders,
              columnSpan: cells.length,
              children: [new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text, bold: true, size: 19 })] })]
            })
          ]
        })
      );
      return;
    }

    const tcells = cells.map((td, idx) => {
      const isAmt = td.classList.contains("amt");
      return new TableCell({
        borders: isBold ? { ...noBorders, top: topBorder } : noBorders,
        width: idx === 0 ? { size: 70, type: WidthType.PERCENTAGE } : { size: 30, type: WidthType.PERCENTAGE },
        children: [
          new Paragraph({
            alignment: isAmt ? AlignmentType.RIGHT : AlignmentType.LEFT,
            indent: td.classList.contains("label") && tr.classList.contains("row-indent") ? { left: 300 } : undefined,
            children: [new TextRun({ text: cellText(td), bold: isBold, size: 19 })]
          })
        ]
      });
    });
    rows.push(new TableRow({ children: tcells }));
  });

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function buildDocxParagraphsFromBlock(container) {
  const { Paragraph, TextRun, Italics } = docx;
  const paras = [];
  container.querySelectorAll("p").forEach((p) => {
    paras.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: cellText(p), italics: true, size: 18 })]
      })
    );
  });
  return paras;
}

function buildDocxSignature(div) {
  const { Paragraph, TextRun } = docx;
  const paras = [];
  const disclaimer = div.querySelector(".disclaimer");
  const signFor = div.querySelector(".sign-for");
  const signName = div.querySelector(".sign-name");
  const signRole = div.querySelector(".sign-role");
  if (disclaimer) paras.push(new Paragraph({ spacing: { before: 200, after: 160 }, children: [new TextRun({ text: cellText(disclaimer), italics: true, size: 16 })] }));
  if (signFor) paras.push(new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: cellText(signFor), bold: true, size: 19 })] }));
  paras.push(new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: "" })] }));
  if (signName) paras.push(new Paragraph({ children: [new TextRun({ text: cellText(signName), bold: true, size: 19 })] }));
  if (signRole) paras.push(new Paragraph({ children: [new TextRun({ text: cellText(signRole), size: 18 })] }));
  return paras;
}

async function exportWord() {
  if (!currentModel) return;
  els.btnWord.disabled = true;
  els.btnWord.textContent = "Preparing…";
  try {
    const { Document, Packer } = docx;
    const children = [];
    const root = els.sheetContent;

    Array.from(root.children).forEach((node) => {
      if (node.classList.contains("letterhead")) {
        children.push(...buildDocxParagraphsFromLetterhead(node));
      } else if (node.classList.contains("doc-title")) {
        children.push(buildDocxTitle(node));
      } else if (node.classList.contains("info-grid")) {
        children.push(buildDocxInfoGrid(node));
      } else if (node.classList.contains("sec-head") || node.classList.contains("sched-head")) {
        children.push(buildDocxSectionHead(node));
      } else if (node.tagName === "TABLE") {
        children.push(buildDocxCompTable(node));
      } else if (node.classList.contains("remarks")) {
        children.push(...buildDocxParagraphsFromBlock(node));
      } else if (node.classList.contains("schedules")) {
        Array.from(node.children).forEach((sub) => {
          if (sub.classList.contains("sched-head")) children.push(buildDocxSectionHead(sub));
          else if (sub.tagName === "TABLE") children.push(buildDocxCompTable(sub));
          else if (sub.tagName === "P") {
            children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: cellText(sub), italics: true, size: 16 })] }));
          }
        });
      } else if (node.classList.contains("sign-block")) {
        children.push(...buildDocxSignature(node));
      } else if (node.tagName === "P" && node.classList.contains("note")) {
        children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: cellText(node), italics: true, size: 16 })] }));
      }
    });

    const doc = new Document({
      sections: [
        {
          properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
          children
        }
      ],
      styles: { default: { document: { run: { font: "Georgia" } } } }
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (currentModel.name || "ITR_Computation").replace(/[^a-z0-9]+/gi, "_");
    a.href = url;
    a.download = `${safeName}_ITR_Computation_AY${currentModel.ay}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    showError("Word export failed: " + err.message);
  } finally {
    els.btnWord.disabled = false;
    els.btnWord.textContent = "Download Word";
  }
}
