'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const source = require('../js/duvri-source-bytes.js');
const manifest = require('../js/duvri-case-manifest.js');

const jobId = 'JOB_SINT_123456';
const checklist = Uint8Array.from([80, 75, 3, 4, 1, 0, 0, 0]);
const pdf = Uint8Array.from(Buffer.from('%PDF-1.4\nsynthetic-only\n%%EOF', 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function files() {
  return {
    documents: [
      {file_id: 'FILE_SINT_CHECKLIST_00001', job_id: jobId,
        role:'client_checklist', mime_type: manifest.CHECKLIST_MIME,
        size_bytes:checklist.length, sha256:hash(checklist), parse_status:'pending'},
      {file_id:'FILE_SINT_ATTACHMENT_00002',job_id:jobId,
        role:'supporting_document',mime_type:'application/pdf',
        size_bytes:pdf.length,sha256:hash(pdf),parse_status:'pending'},
    ],
    inputs:[
      {file_id:'FILE_SINT_CHECKLIST_00001',bytes:checklist},
      {file_id:'FILE_SINT_ATTACHMENT_00002',bytes:pdf},
    ],
  };
}
const assess = async ({documents,inputs}, validator=manifest.assessManifest) =>
  source.assessBytes({jobId,documents,inputs},{
    manifestValidator:validator,cryptoProvider:webcrypto,
  });

test('valid fixture bytes match manifest, but no provenance/issuance is claimed',async()=>{
  const outcome=await assess(files());
  assert.equal(outcome.state,'bytes_match_manifest_pending_auth_and_parsing');
  assert.equal(outcome.bytes_matched_manifest,true);
  assert.equal(outcome.verified_count,2);
  assert.equal(outcome.formats_requiring_full_parser,1);
  assert.equal(outcome.source_authenticated,false);
  assert.equal(outcome.private_storage_verified,false);
  assert.equal(outcome.format_structure_verified,false);
  assert.equal(outcome.issuance_allowed,false);
});
test('byte data in opposite order still matches by its exact file ID',async()=>{
  const f=files();f.inputs.reverse();
  assert.equal((await assess(f)).bytes_matched_manifest,true);
});
test('PDF bytes swapped with DOCX are blocked',async()=>{
  const f=files();const [a,b]=f.inputs;[a.bytes,b.bytes]=[b.bytes,a.bytes];
  assert.equal((await assess(f)).state,'blocked');
});
test('checksum declared incorrectly is blocked',async()=>{
  const f=files();f.documents[1].sha256='a'.repeat(64);
  assert.deepEqual((await assess(f)).blocker_codes,['SOURCE_SHA256_MISMATCH']);
});
test('declared byte count differs from actual',async()=>{
  const f=files();f.documents[1].size_bytes++;
  assert.deepEqual((await assess(f)).blocker_codes,['SOURCE_SIZE_MISMATCH']);
});
test('PDF signature incorrectly declared is blocked even when hash matches',async()=>{
  const f=files();const fake=Uint8Array.from(Buffer.from('NOTPDF'));f.inputs[1].bytes=fake;
  f.documents[1].sha256=hash(fake);f.documents[1].size_bytes=fake.length;
  assert.deepEqual((await assess(f)).blocker_codes,['SOURCE_SIGNATURE_MISMATCH']);
});
test('DOCX header must at least have a ZIP signature',async()=>{
  const f=files();const fake=Uint8Array.from(Buffer.from('NOTZIP'));f.inputs[0].bytes=fake;
  f.documents[0].sha256=hash(fake);f.documents[0].size_bytes=fake.length;
  assert.deepEqual((await assess(f)).blocker_codes,['SOURCE_SIGNATURE_MISMATCH']);
});
test('missing attachment byte record blocked',async()=>{
  const f=files();f.inputs.pop();
  assert.equal((await assess(f)).state,'blocked');
});
test('foreign extra byte record blocked',async()=>{
  const f=files();f.inputs.push({file_id:'FILE_SINT_FOREIGN_00003',bytes:pdf});
  assert.equal((await assess(f)).state,'blocked');
});
test('duplicate byte record IDs blocked',async()=>{
  const f=files();f.inputs[1].file_id=f.inputs[0].file_id;
  assert.deepEqual((await assess(f)).blocker_codes,['DUPLICATE_OR_INVALID_BYTE_RECORD']);
});
test('two declared client checklists blocked by metadata validator',async()=>{
  const f=files();f.documents[1].role='client_checklist';
  assert.equal((await assess(f)).state,'blocked');
});
test('extra metadata on byte record blocked',async()=>{
  const f=files();f.inputs[0].path='/sensitive/host/secret';
  assert.equal((await assess(f)).state,'blocked');
});
test('non-byte strings never accepted as file content',async()=>{
  const f=files();f.inputs[1].bytes='literally %PDF';
  assert.equal((await assess(f)).state,'blocked');
});
test('manifest validator must be supplied explicitly by trusted caller',async()=>{
  const f=files();const outcome=await source.assessBytes({jobId,...f},{cryptoProvider:webcrypto});
  assert.deepEqual(outcome.blocker_codes,['TRUSTED_MANIFEST_VALIDATOR_REQUIRED']);
});
test('manifest validator errors are blocked without leaking exception text',async()=>{
  const f=files();const outcome=await assess(f,()=>{throw new Error('secret');});
  assert.deepEqual(outcome.blocker_codes,['MANIFEST_VALIDATION_FAILED']);
  assert.doesNotMatch(JSON.stringify(outcome),/secret|FILE_SINT/);
});
test('crypto unavailable is a block',async()=>{
  const f=files();const o=await source.assessBytes({jobId,...f},
    {manifestValidator:manifest.assessManifest});
  assert.deepEqual(o.blocker_codes,['SECURE_SHA256_UNAVAILABLE']);
});
test('bypassing digest by throwing is blocked',async()=>{
  const f=files();const o=await source.assessBytes({jobId,...f},{
    manifestValidator:manifest.assessManifest,
    cryptoProvider:{subtle:{digest:async()=>{throw new Error('provider-down');}}},
  });
  assert.deepEqual(o.blocker_codes,['SHA256_COMPUTATION_FAILED']);
  assert.doesNotMatch(JSON.stringify(o),/provider-down/);
});
test('caller can forge all hashes, but output never claims authenticated source',async()=>{
  const f=files();const replacement=Uint8Array.from(Buffer.from('%PDF-1.5\nnew synthetic\n%%EOF'));
  f.inputs[1].bytes=replacement;f.documents[1].size_bytes=replacement.length;
  f.documents[1].sha256=hash(replacement);
  const o=await assess(f);
  assert.equal(o.bytes_matched_manifest,true);
  assert.equal(o.source_authenticated,false);
  assert.equal(o.private_storage_verified,false);
  assert.equal(o.issuance_allowed,false);
});
test('valid JPEG, TIFF, PNG and WebP headers are recognized as candidates',()=>{
  assert.equal(source.signatureMatches('image/jpeg',Uint8Array.from([255,216,255,0])),true);
  assert.equal(source.signatureMatches('image/tiff',Uint8Array.from([73,73,42,0])),true);
  assert.equal(source.signatureMatches('image/png',Uint8Array.from([137,80,78,71,13,10,26,10])),true);
  const webp=Uint8Array.from([82,73,70,70,0,0,0,0,87,69,66,80]);
  assert.equal(source.signatureMatches('image/webp',webp),true);
  assert.equal(source.signatureMatches('image/png',Uint8Array.from([1,2,3])),false);
});
test('format with no reliable magic remains outside full verification',()=>{
  assert.equal(source.signatureMatches('text/plain',Uint8Array.from([65])),null);
  assert.equal(source.signatureMatches('image/heic',Uint8Array.from([0])),null);
});
