/*
 * Colligo DUVRI — independent SHA-256 verification of supplied upload bytes.
 *
 * This module does NOT authenticate uploads, check storage ACLs or trust the
 * caller. In production use ONLY in a trusted backend after retrieving bytes
 * and canonical manifest from authenticated, access-controlled storage.
 *
 * Never use a browser-provided checksum as proof of server-side provenance.
 * Never issue a DUVRI based on this result.
 */
const duvriSourceBytes = (() => {
  'use strict';
  const MAX_SINGLE_BYTES = 64 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
  const MAX_FILES = 200;
  const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
  const bytesOf = value => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
  };
  const isPrefix = (bytes, prefix) =>
    prefix.every((v, i) => i < bytes.length && bytes[i] === v);
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d];
  const zip = [0x50, 0x4b, 0x03, 0x04];
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const jpeg = [0xff, 0xd8, 0xff];
  const webpRiff = [0x52, 0x49, 0x46, 0x46];
  const webpTail = [0x57, 0x45, 0x42, 0x50];
  const tiffLe = [0x49, 0x49, 0x2a, 0x00];
  const tiffBe = [0x4d, 0x4d, 0x00, 0x2a];

  function signatureMatches(mime, bytes) {
    switch (mime) {
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      case 'application/zip':
      case 'application/x-zip-compressed':
        // This is only a ZIP signature, not an OOXML package examination.
        return isPrefix(bytes, zip);
      case 'application/pdf':
        return isPrefix(bytes, pdf);
      case 'image/png':
        return isPrefix(bytes, png);
      case 'image/jpeg':
        return isPrefix(bytes, jpeg);
      case 'image/webp':
        return isPrefix(bytes, webpRiff) &&
          bytes.length >= 12 && isPrefix(bytes.subarray(8), webpTail);
      case 'image/tiff':
        return isPrefix(bytes, tiffLe) || isPrefix(bytes, tiffBe);
      default:
        // No magic check for text, RTF, old DOC, HEIC etc. These remain
        // explicitly unverified formats requiring a separate parser.
        return null;
    }
  }

  function deny(code) {
    return Object.freeze({
      schema_version: 'colligo-duvri-byte-provenance/1.0',
      state: 'blocked',
      bytes_matched_manifest: false,
      format_structure_verified: false,
      source_authenticated: false,
      private_storage_verified: false,
      verified_count: 0,
      issuance_allowed: false,
      blocker_codes: [code],
    });
  }
  const hex = b => Array.from(new Uint8Array(b), n =>
    n.toString(16).padStart(2, '0')).join('');

  async function assessBytes({ jobId, documents, inputs } = {}, {
    manifestValidator, cryptoProvider,
  } = {}) {
    if (typeof manifestValidator !== 'function')
      return deny('TRUSTED_MANIFEST_VALIDATOR_REQUIRED');
    let manifest;
    try {
      manifest = manifestValidator({ jobId, documents });
    } catch (_) {
      return deny('MANIFEST_VALIDATION_FAILED');
    }
    if (!manifest || manifest.state === 'blocked' ||
        !Array.isArray(documents) || !Array.isArray(inputs) ||
        documents.length < 1 || documents.length > MAX_FILES ||
        inputs.length !== documents.length)
      return deny('MISSING_OR_INVALID_INPUT_SET');
    if (!cryptoProvider || !cryptoProvider.subtle ||
        typeof cryptoProvider.subtle.digest !== 'function')
      return deny('SECURE_SHA256_UNAVAILABLE');

    const byId = new Map();
    let total = 0;
    for (const input of inputs) {
      if (!input || typeof input !== 'object' ||
          Object.keys(input).some(k => !['file_id', 'bytes'].includes(k)) ||
          typeof input.file_id !== 'string' || byId.has(input.file_id))
        return deny('DUPLICATE_OR_INVALID_BYTE_RECORD');
      const bytes = bytesOf(input.bytes);
      if (!bytes || bytes.byteLength < 1 ||
          bytes.byteLength > MAX_SINGLE_BYTES)
        return deny('INVALID_BYTE_SIZE_OR_TYPE');
      total += bytes.byteLength;
      if (!Number.isSafeInteger(total) || total > MAX_TOTAL_BYTES)
        return deny('TOTAL_BYTES_LIMIT_EXCEEDED');
      byId.set(input.file_id, bytes);
    }
    let count = 0, formatsNotVerified = 0;
    for (const doc of documents) {
      if (!doc || typeof doc !== 'object' || !byId.has(doc.file_id))
        return deny('SOURCE_BYTES_MISSING');
      const original = byId.get(doc.file_id);
      if (original.byteLength !== doc.size_bytes)
        return deny('SOURCE_SIZE_MISMATCH');
      // Snapshot before yielding to the asynchronous digest. Do not hash a
      // concurrently mutated caller-owned ArrayBuffer.
      const snapshot = Uint8Array.from(original);
      let digest;
      try {
        digest = hex(await cryptoProvider.subtle.digest('SHA-256', snapshot));
      } catch (_) {
        return deny('SHA256_COMPUTATION_FAILED');
      }
      if (typeof doc.sha256 !== 'string' ||
          digest !== doc.sha256.toLowerCase())
        return deny('SOURCE_SHA256_MISMATCH');
      const magic = signatureMatches(doc.mime_type, snapshot);
      if (magic === false)
        return deny('SOURCE_SIGNATURE_MISMATCH');
      if (magic === null ||
          doc.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          doc.mime_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          doc.mime_type === 'application/zip' ||
          doc.mime_type === 'application/x-zip-compressed')
        formatsNotVerified++;
      count++;
    }
    return Object.freeze({
      schema_version: 'colligo-duvri-byte-provenance/1.0',
      state: 'bytes_match_manifest_pending_auth_and_parsing',
      bytes_matched_manifest: true,
      format_structure_verified: false,
      formats_requiring_full_parser: formatsNotVerified,
      source_authenticated: false,
      private_storage_verified: false,
      verified_count: count,
      issuance_allowed: false,
      blocker_codes: ['PRIVATE_BACKEND_AUTH_REQUIRED', 'FULL_FORMAT_VALIDATION_REQUIRED',
        'HSE_REVIEW_REQUIRED', 'D1_D2_PENDING', 'WORD_VISUAL_QA_PENDING'],
    });
  }
  return Object.freeze({
    MAX_SINGLE_BYTES, MAX_TOTAL_BYTES, signatureMatches, assessBytes,
  });
})();
if (typeof module !== 'undefined' && module.exports)
  module.exports = duvriSourceBytes;
