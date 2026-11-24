/**
 * Writes the Factur-X samples (French franchise, VAT, credit note, reverse charge) and validates each with
 * veraPDF (PDF/A-3B), the CEN EN 16931 CII Schematron (official XSLT) and Mustang (Factur-X as a whole).
 * Usage: VERAPDF=… MUSTANG_JAR=… CEN_CII_XSLT=… bun apps/server/src/cli/einvoice-validate.ts <out-dir>
 * A validator whose variable is unset is skipped and reported; any failure exits with status 1.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { frenchSamples, renderSample } from '../features/documents/einvoice.samples.ts';
import { renderPdf } from '../features/documents/pdf.ts';
import { PackRegistry } from '../features/packs/packs.ts';

const out = resolve(process.argv[2] ?? 'einvoice-samples');
const { VERAPDF, MUSTANG_JAR, CEN_CII_XSLT } = process.env;
const pack = (await PackRegistry.load()).get('FR');
if (!pack) throw new Error('French pack missing');
await mkdir(out, { recursive: true });

/**
 * Runs a validator and returns its standard output
 *
 * @param cmd {string[]} - command and arguments
 * @returns {Promise<string>} - output
 */
async function run(cmd: string[]): Promise<string> {
  const child = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  await child.exited;
  return `${stdout}\n${stderr}`;
}

let failed = false;
/**
 * Prints one validation result and remembers a failure
 *
 * @param name {string} - sample
 * @param tool {string} - validator
 * @param ok {boolean} - passed
 * @param detail {string} - validator output on failure
 * @returns {void} - nothing
 */
const report = (name: string, tool: string, ok: boolean, detail = '') => {
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${tool.padEnd(22)} ${name}${detail ? `\n${detail}` : ''}`);
};

// Every PDF is PDF/A-3B, not only Factur-X: a draft quote with a logo, the watermark and the serif face.
const [first] = frenchSamples(pack);
if (first && VERAPDF) {
  const pdfPath = resolve(out, 'classic-draft.pdf');
  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
    (char) => char.charCodeAt(0),
  );
  await writeFile(
    pdfPath,
    await renderPdf({
      ...first.source,
      type: 'quote',
      draft: true,
      number: null,
      relatedNumber: null,
      validUntil: '2026-12-24',
      language: 'fr',
      style: { accent: '#1d4ed8', layout: 'band', font: 'serif', logo: { mime: 'image/png', bytes: png } },
    }),
  );
  const text = await run([VERAPDF, '--flavour', '3b', '--format', 'text', pdfPath]);
  report('classic-draft', 'veraPDF PDF/A-3B', /^PASS /m.test(text), /^PASS /m.test(text) ? '' : text.trim());
}

for (const sample of frenchSamples(pack)) {
  const { xml, pdf } = await renderSample(sample, pack);
  const pdfPath = resolve(out, `${sample.name}.pdf`);
  const xmlPath = resolve(out, `${sample.name}.xml`);
  await writeFile(pdfPath, pdf);
  await writeFile(xmlPath, xml);

  if (VERAPDF) {
    const text = await run([VERAPDF, '--flavour', '3b', '--format', 'text', pdfPath]);
    report(sample.name, 'veraPDF PDF/A-3B', /^PASS /m.test(text), /^PASS /m.test(text) ? '' : text.trim());
  } else console.log(`SKIP  veraPDF (VERAPDF unset)  ${sample.name}`);

  if (MUSTANG_JAR && CEN_CII_XSLT) {
    const svrl = await run([
      'java',
      '-cp',
      MUSTANG_JAR,
      'net.sf.saxon.Transform',
      `-s:${xmlPath}`,
      `-xsl:${CEN_CII_XSLT}`,
    ]);
    const asserts = [...svrl.matchAll(/<svrl:failed-assert[^>]*id="([^"]+)"[^>]*flag="(\w+)"/g)];
    const fatal = asserts.filter((match) => match[2] === 'fatal').map((match) => match[1]);
    const ran = svrl.includes('schematron-output');
    report(
      sample.name,
      'Schematron EN16931',
      ran && fatal.length === 0,
      ran ? fatal.join(', ') : svrl.trim().slice(0, 2000),
    );
  } else console.log(`SKIP  Schematron (MUSTANG_JAR or CEN_CII_XSLT unset)  ${sample.name}`);

  if (MUSTANG_JAR) {
    const text = await run([
      'java',
      '-jar',
      MUSTANG_JAR,
      '--action',
      'validate',
      '--source',
      pdfPath,
      '--no-notices',
    ]);
    const ok = /<summary status=["']valid["']/.test(text);
    report(sample.name, 'Mustang Factur-X', ok, ok ? '' : text.trim().slice(-3000));
  } else console.log(`SKIP  Mustang (MUSTANG_JAR unset)  ${sample.name}`);
}

process.exit(failed ? 1 : 0);
