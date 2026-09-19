import puppeteer from "@cloudflare/puppeteer";

const ROUTE = "/forms/chromium/convert/html";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-pdf-service-token"
        }
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", {
        headers: { "Cache-Control": "no-store" }
      });
    }

    if (url.pathname !== ROUTE) {
      return new Response("Not found", { status: 404 });
    }

    if (
      !env.PDF_SERVICE_TOKEN ||
      request.headers.get("x-pdf-service-token") !== env.PDF_SERVICE_TOKEN
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "POST, OPTIONS" }
      });
    }

    let html = "";

    const contentType = request.headers.get("content-type") || "";

    try {
      if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        const value = form.get("html");

        if (typeof value !== "string") {
          return new Response("Missing html field", { status: 400 });
        }

        html = value;
      } else {
        const body = await request.json();

        if (!body || typeof body.html !== "string") {
          return new Response("Missing html", { status: 400 });
        }

        html = body.html;
      }
    } catch (error) {
      return new Response(
        "Invalid request body: " + String(error?.message || error),
        { status: 400 }
      );
    }

    if (!html.trim()) {
      return new Response("Empty html", { status: 400 });
    }

    let browser;

    try {
      browser = await puppeteer.launch(env.BROWSER);

      const page = await browser.newPage();

      await page.setViewport({
        width: 1280,
        height: 1800,
        deviceScaleFactor: 1
      });

      await page.setContent(html, {
        waitUntil: "networkidle0"
      });

      await page.waitForFunction(
        () => {
          const errors = document.querySelectorAll(".mjx-merror").length;

          if (errors > 0) return false;

          const ready = document.documentElement.getAttribute(
            "data-mathjax-ready"
          );

          const containers = document.querySelectorAll(
            "mjx-container"
          ).length;

          const svgs = document.querySelectorAll(
            "mjx-container svg"
          ).length;

          // Production MathJax explicitly signals completion.
          if (ready === "true") {
            return true;
          }

          // Already-rendered MathJax.
          if (containers > 0) {
            return svgs >= containers;
          }

          // No MathJax containers: allow plain HTML documents to continue.
          // MathJax documents with formulas will expose mjx-container as soon
          // as rendering starts; the explicit production-ready marker is used
          // when the production MathJax bundle is present.
          return !document.querySelector("mjx-container");
        },
        { timeout: 30000 }
      );

      const mathState = await page.evaluate(() => ({
        ready: document.documentElement.getAttribute(
          "data-mathjax-ready"
        ),
        containers: document.querySelectorAll(
          "mjx-container"
        ).length,
        svgs: document.querySelectorAll(
          "mjx-container svg"
        ).length,
        errors: document.querySelectorAll(
          ".mjx-merror"
        ).length
      }));

      if (mathState.errors > 0) {
        throw new Error(
          `MathJax a produit ${mathState.errors} erreur(s).`
        );
      }

      if (
        mathState.containers > 0 &&
        mathState.svgs < mathState.containers
      ) {
        throw new Error(
          "Le rendu SVG MathJax est incomplet."
        );
      }

      await page.evaluate(async () => {
        if (document.fonts?.ready) {
          await document.fonts.ready;
        }

        await new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(resolve)
          )
        );
      });

      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
        margin: {
          top: "0",
          right: "0",
          bottom: "0",
          left: "0"
        }
      });

      if (!pdf || pdf.length < 1000) {
        throw new Error("PDF vide ou anormalement petit.");
      }

      const signature = new TextDecoder().decode(
        pdf.slice(0, 5)
      );

      if (signature !== "%PDF-") {
        throw new Error("La sortie Chromium n'est pas un PDF valide.");
      }

      return new Response(pdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="aurore.pdf"',
          "Cache-Control": "no-store"
        }
      });
    } catch (error) {
      return new Response(
        "PDF generation failed: " +
          String(error?.stack || error?.message || error),
        {
          status: 500,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  }
};
