/**
 * Sahayak — Zero-Dependency Release ZIP Builder (Slice 4.4)
 *
 * Packages extension files into a clean distribution ZIP (sahayak-vX.Y.Z.zip).
 * Uses pure Node.js (zlib + Buffer) with standard PK zip structures so it runs
 * cross-platform without needing any external npm packages or CLI tools.
 *
 * Architecture reference: §18.2, §18.3
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT_DIR = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
const VERSION = manifest.version || '1.0.0';
const OUTPUT_ZIP = path.join(ROOT_DIR, `sahayak-v${VERSION}.zip`);

// Explicit whitelist of directories and files to include (§18.3)
const INCLUDED_ENTRIES = [
  'manifest.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'icons',
  'background',
  'content',
  'sidepanel',
  'services',
  'safety'
];

/**
 * Recursively collect all files from a directory.
 */
function collectFiles(dirPath, baseDir) {
  let results = [];
  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (item.isDirectory()) {
      results = results.concat(collectFiles(fullPath, baseDir));
    } else if (item.isFile()) {
      results.push({ fullPath, relPath });
    }
  }
  return results;
}

/**
 * Pure Node.js ZIP file generator.
 */
function createZip(files, outputPath) {
  const localHeaders = [];
  const centralRecords = [];
  let offset = 0;

  for (const file of files) {
    const data = fs.readFileSync(file.fullPath);
    const nameBuf = Buffer.from(file.relPath, 'utf8');
    const crc = zlib.crc32(data);
    const compressed = zlib.deflateRawSync(data);

    // Format DOS time / date
    const stat = fs.statSync(file.fullPath);
    const mtime = new Date(stat.mtime);
    const dosTime = ((mtime.getHours() << 11) | (mtime.getMinutes() << 5) | (mtime.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((mtime.getFullYear() - 1980) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate()) & 0xFFFF;

    // 1. Local file header (30 bytes + nameBuf.length)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6);          // General purpose bit flag
    localHeader.writeUInt16LE(8, 8);          // Compression method (8 = deflate)
    localHeader.writeUInt16LE(dosTime, 10);   // File modification time
    localHeader.writeUInt16LE(dosDate, 12);   // File modification date
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(compressed.length, 18); // Compressed size
    localHeader.writeUInt32LE(data.length, 22);       // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);    // Filename length
    localHeader.writeUInt16LE(0, 28);                 // Extra field length
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressed);

    // 2. Central directory file header (46 bytes + nameBuf.length)
    const centralRecord = Buffer.alloc(46 + nameBuf.length);
    centralRecord.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralRecord.writeUInt16LE(20, 4);         // Version made by
    centralRecord.writeUInt16LE(20, 6);         // Version needed to extract
    centralRecord.writeUInt16LE(0, 8);          // General purpose bit flag
    centralRecord.writeUInt16LE(8, 10);         // Compression method
    centralRecord.writeUInt16LE(dosTime, 12);   // File modification time
    centralRecord.writeUInt16LE(dosDate, 14);   // File modification date
    centralRecord.writeUInt32LE(crc, 16);       // CRC-32
    centralRecord.writeUInt32LE(compressed.length, 20); // Compressed size
    centralRecord.writeUInt32LE(data.length, 24);       // Uncompressed size
    centralRecord.writeUInt16LE(nameBuf.length, 28);    // Filename length
    centralRecord.writeUInt16LE(0, 30);                 // Extra field length
    centralRecord.writeUInt16LE(0, 32);                 // Comment length
    centralRecord.writeUInt16LE(0, 34);                 // Disk number start
    centralRecord.writeUInt16LE(0, 36);                 // Internal file attributes
    centralRecord.writeUInt32LE(0, 38);                 // External file attributes
    centralRecord.writeUInt32LE(offset, 42);            // Relative offset of local header
    nameBuf.copy(centralRecord, 46);

    centralRecords.push(centralRecord);

    offset += localHeader.length + compressed.length;
  }

  const centralDirStart = offset;
  let centralDirSize = 0;
  for (const cr of centralRecords) {
    centralDirSize += cr.length;
  }

  // 3. End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);                 // EOCD signature
  eocd.writeUInt16LE(0, 4);                          // Number of this disk
  eocd.writeUInt16LE(0, 6);                          // Disk where central directory starts
  eocd.writeUInt16LE(files.length, 8);               // Number of central directory records on this disk
  eocd.writeUInt16LE(files.length, 10);              // Total number of central directory records
  eocd.writeUInt32LE(centralDirSize, 12);            // Size of central directory
  eocd.writeUInt32LE(centralDirStart, 16);           // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);                         // Comment length

  const finalZipBuffer = Buffer.concat([...localHeaders, ...centralRecords, eocd]);
  fs.writeFileSync(outputPath, finalZipBuffer);
  return finalZipBuffer.length;
}

function build() {
  console.log(`📦 Packaging Sahayak v${VERSION} release ZIP...`);

  const filesToInclude = [];
  for (const entry of INCLUDED_ENTRIES) {
    const fullPath = path.join(ROOT_DIR, entry);
    if (!fs.existsSync(fullPath)) continue;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      filesToInclude.push(...collectFiles(fullPath, ROOT_DIR));
    } else {
      filesToInclude.push({ fullPath, relPath: entry });
    }
  }

  const zipSize = createZip(filesToInclude, OUTPUT_ZIP);
  const sizeKb = (zipSize / 1024).toFixed(1);

  console.log(`✓ Release archive created: ${path.basename(OUTPUT_ZIP)} (${sizeKb} KB, ${filesToInclude.length} files)`);
  console.log(`✓ Output path: ${OUTPUT_ZIP}`);
}

build();

