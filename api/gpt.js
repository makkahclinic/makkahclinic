<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Insurance Case Analyzer</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  </head>
  <body style="font-family: Arial; padding: 20px">
    <h1>🩺 Insurance Medical Case Analyzer</h1>

    <textarea
      id="caseText"
      rows="5"
      cols="60"
      placeholder="Enter patient case text..."
    ></textarea>
    <br />
    <input type="file" id="fileInput" accept="image/*" />
    <br />
    <button onclick="analyzeCase()">Analyze Case (Text/Image)</button>

    <div id="result-section" style="margin-top: 20px"></div>

    <script>
      async function analyzeCase() {
        const caseText = document.getElementById("caseText").value;
        const file = document.getElementById("fileInput").files[0];
        const formData = new FormData();
        formData.append("caseText", caseText);
        if (file) formData.append("file", file);

        const res = await fetch("/api/gpt", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        const openaiResult =
          data.openai?.choices?.[0]?.message?.content || "N/A";
        const geminiResult =
          data.gemini?.candidates?.[0]?.content?.parts?.[0]?.text || "N/A";

        document.getElementById("result-section").innerHTML = `
          <h2>📊 Analysis Result</h2>
          <table border="1" cellpadding="10" style="border-collapse: collapse; width: 100%">
            <thead>
              <tr>
                <th>Aspect</th>
                <th>ChatGPT (OpenAI)</th>
                <th>Gemini</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Diagnosis & Procedures</td>
                <td>${openaiResult}</td>
                <td>${geminiResult}</td>
              </tr>
            </tbody>
          </table>
          <button onclick="exportPDF()" style="margin-top: 20px">Export to PDF</button>
        `;
      }

      function exportPDF() {
        const element = document.getElementById("result-section");
        html2pdf().from(element).save("insurance_case_analysis.pdf");
      }
    </script>
  </body>
</html>
