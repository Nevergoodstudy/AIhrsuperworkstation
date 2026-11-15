import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { extractResume, ruleAnalysis } from '../server/resumes.mjs';
import { analyzeWithAI } from '../server/ai.mjs';
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(files){const locals=[],central=[];let offset=0;for(const [name,text] of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(text),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(crc32(data),14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);const entry=Buffer.concat([head,n,data]);locals.push(entry);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc32(data),16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=entry.length;}const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(locals.length,8);end.writeUInt16LE(locals.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,end]);}
function pdf(){const content='BT /F1 12 Tf 30 100 Td (Node.js SQL resume experience) Tj ET';const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream'];let out='%PDF-1.4\n',offsets=[0];for(let i=0;i<objs.length;i++){offsets.push(Buffer.byteLength(out));out+=(i+1)+' 0 obj\n'+objs[i]+'\nendobj\n';}const xref=Buffer.byteLength(out);out+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(out);}
test('UTF-8、DOCX 和 PDF 解析及伪装文件拒绝',async()=>{
 assert.match(await extractResume(Buffer.from('拥有 Node.js 与 SQL 项目经验。'),'resume.txt'),/SQL/);
 const docx=zip({'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>','word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Node.js and SQL engineering experience.</w:t></w:r></w:p></w:body></w:document>'});
 assert.match(await extractResume(docx,'resume.docx'),/SQL engineering/);
 assert.match(await extractResume(pdf(),'resume.pdf'),/SQL resume/);
 await assert.rejects(extractResume(Buffer.from('not a PDF document'),'bad.pdf'),/PDF/);
 await assert.rejects(extractResume(Buffer.from([255,254,0,1,2]),'bad.txt'));
 await assert.rejects(extractResume(Buffer.from('some text'),'bad.exe'),/仅支持/);
 await assert.rejects(extractResume(zip({'a.txt':'x'}),'bad.docx'),/有效的 DOCX/);
});
test('关键词得分没有虚构下限，原文证据可定位',()=>{
 assert.equal(ruleAnalysis('完全无关的简历',['SQL']).score,0);assert.equal(ruleAnalysis('空要求',[]).score,null);const r=ruleAnalysis('使用 SQL 进行业务分析',['SQL','Python']);assert.equal(r.score,50);assert.equal(r.evidence[0].quote,'使用 SQL 进行业务分析');
});
test('AI 仅接受岗位要求和连续原文证据，支持跨分块 UTF-8',async t=>{
 let content={summary:'需要人工核实的中文概述',evidence:[{requirement:'SQL',quote:'使用 SQL 分析订单'}]};let request;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;request=JSON.parse(body);res.writeHead(200,{'Content-Type':'application/json'});const bytes=Buffer.from(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}));for(let i=0;i<bytes.length;i+=2)res.write(bytes.subarray(i,i+2));res.end();});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const config={env:'test',aiBaseUrl:'http://127.0.0.1:'+server.address().port,aiKey:'private-test-key',aiModel:'test-only-model'};
 const r=await analyzeWithAI(config,'我使用 SQL 分析订单。',{title:'分析师',requirements:['SQL','Python']});assert.equal(r.score,50);assert.equal(r.method,'ai');assert.match(r.summary,/中文/);assert.equal(request.model,'test-only-model');
 content={summary:'虚构证据',evidence:[{requirement:'SQL',quote:'不存在的原文'}]};await assert.rejects(analyzeWithAI(config,'SQL',{title:'分析师',requirements:['SQL']}),/未通过校验/);
 content={summary:'无关要求',evidence:[{requirement:'秘密能力',quote:'SQL'}]};await assert.rejects(analyzeWithAI(config,'SQL',{title:'分析师',requirements:['SQL']}),/未通过校验/);
 await assert.rejects(analyzeWithAI({...config,aiKey:''},'SQL',{title:'分析师',requirements:['SQL']}),/尚未配置/);
});
