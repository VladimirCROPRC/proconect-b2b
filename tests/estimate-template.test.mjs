import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';

const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'transform', disableExperimentalWarning: true })).toString('base64');
const valuesUrl = moduleUrl(await source('app/estimate-values.ts'));
const reportUrl = moduleUrl((await source('app/technician-report.ts')).replace('"./estimate-values"', JSON.stringify(valuesUrl)));
const templateCode = (await source('app/estimate-template.ts')).replace('"fflate"', JSON.stringify(import.meta.resolve('fflate'))).replace('"./technician-report"', JSON.stringify(reportUrl));
const { fillEstimateTemplate } = await import(moduleUrl(templateCode));
const { estimateTotal } = await import(valuesUrl);
const template = await readFile(new URL('../public/templates/boq-vbts-fo-prc.xlsx', import.meta.url));

test('template is exactly the attached source workbook', () => {
  assert.equal(createHash('sha256').update(template).digest('hex'), '285d29f1ae520d5a32e791bcc6b78f2b0085db1d737a42f4d15afce0bd5f6cd8');
});

test('export fills original cells, aggregates positions, and preserves the complete original format', () => {
  const rows = [
    { id:'p1', catalogPosition:'108', quantity:3, unitPrice:3.5823, selected:true },
    { id:'p2', catalogPosition:'108', quantity:3, unitPrice:3.5823, selected:true },
    { id:'j', catalogPosition:'102', quantity:1, unitPrice:14.09038, selected:true },
    { id:'included', catalogPosition:'included', quantity:4, unitPrice:0, selected:true },
  ];
  const output=fillEstimateTemplate(template,{id:'RID123',client:'=Client & Șantier'},rows,'2026-11-09');
  const original=unzipSync(template), updated=unzipSync(output);
  assert.deepEqual(Object.keys(updated).sort(),Object.keys(original).sort());
  for(const path of Object.keys(original)) if(path!=='xl/worksheets/sheet1.xml') assert.deepEqual(updated[path],original[path],path);
  const before=strFromU8(original['xl/worksheets/sheet1.xml']),after=strFromU8(updated['xl/worksheets/sheet1.xml']);
  const allowed=new Set(['C2','C3','C4','E4','E6','E102','E108','H102','H108']);
  const mask=xml=>xml.replace(/<c\b([^>]*\br="([A-Z]+\d+)"[^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g,(whole,_attrs,address)=>allowed.has(address)?`<changed r="${address}"/>`:whole);
  assert.equal(mask(after),mask(before),'all layout, rows, columns, labels, styles and unused cells remain byte-identical');
  assert.deepEqual(after.match(/<f\b[^>]*?\/>|<f\b[^>]*>[\s\S]*?<\/f>/g),before.match(/<f\b[^>]*?\/>|<f\b[^>]*>[\s\S]*?<\/f>/g),'original formulas and shared formula ranges preserved');
  assert.equal(estimateTotal(rows),35.58);
  const result=spawnSync('python3',['-c',`import sys,io,zipfile,xml.etree.ElementTree as E
raw=sys.stdin.buffer.read(); z=zipfile.ZipFile(io.BytesIO(raw)); assert z.testzip() is None
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
w=E.fromstring(z.read('xl/worksheets/sheet1.xml')); cells={c.attrib['r']:c for c in w.findall('.//s:c',ns)}
assert cells['E108'].find('s:v',ns).text=='6'
assert cells['H108'].find('s:f',ns).attrib['t']=='shared'
assert abs(float(cells['H108'].find('s:v',ns).text)-21.4938)<1e-9
assert round(float(cells['E6'].find('s:v',ns).text),2)==35.58
assert cells['C4'].attrib['t']=='inlineStr' and ''.join(cells['C4'].itertext())=='=Client & Șantier'
assert ''.join(cells['E4'].itertext())=='RID123'
assert w.find('s:sheetProtection',ns) is not None
try:
 import openpyxl
 f=openpyxl.load_workbook(io.BytesIO(raw),data_only=False)
 v=openpyxl.load_workbook(io.BytesIO(raw),data_only=True)
 assert f.sheetnames==['VBTS Fibre Build','Sheet1']
 assert f.active['E6'].value=='=SUBTOTAL(9,H8:H208)'
 assert f.active['H108'].value=='=IF(F108="Yes",E108*1.25*G108,E108*G108)'
 assert round(v.active['E6'].value,2)==35.58
except ImportError: pass`],{input:output});
  assert.equal(result.status,0,result.stderr.toString());
});
