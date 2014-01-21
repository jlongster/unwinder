(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"PcZj9L":[function(require,module,exports){
var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192

/**
 * If `browserSupport`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (compatible down to IE6)
 */
var browserSupport = (function () {
   // Detect if browser supports Typed Arrays. Supported browsers are IE 10+,
   // Firefox 4+, Chrome 7+, Safari 5.1+, Opera 11.6+, iOS 4.2+.
   if (typeof Uint8Array === 'undefined' || typeof ArrayBuffer === 'undefined' ||
        typeof DataView === 'undefined')
      return false

  // Does the browser support adding properties to `Uint8Array` instances? If
  // not, then that's the same as no `Uint8Array` support. We need to be able to
  // add all the node Buffer API methods.
  // Relevant Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=695438
  try {
    var arr = new Uint8Array(0)
    arr.foo = function () { return 42 }
    return 42 === arr.foo()
  } catch (e) {
    return false
  }
})()


/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Workaround: node's base64 implementation allows for non-padded strings
  // while base64-js does not.
  if (encoding === 'base64' && type === 'string') {
    subject = stringtrim(subject)
    while (subject.length % 4 !== 0) {
      subject = subject + '='
    }
  }

  // Find the length
  var length
  if (type === 'number')
    length = coerce(subject)
  else if (type === 'string')
    length = Buffer.byteLength(subject, encoding)
  else if (type === 'object')
    length = coerce(subject.length) // Assume object is an array
  else
    throw new Error('First argument needs to be a number, array or string.')

  var buf
  if (browserSupport) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = augment(new Uint8Array(length))
  } else {
    // Fallback: Return this instance of Buffer
    buf = this
    buf.length = length
  }

  var i
  if (Buffer.isBuffer(subject)) {
    // Speed optimization -- use set if we're copying from a Uint8Array
    buf.set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    for (i = 0; i < length; i++) {
      if (Buffer.isBuffer(subject))
        buf[i] = subject.readUInt8(i)
      else
        buf[i] = subject[i]
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !browserSupport && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

// STATIC METHODS
// ==============

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
      return true

    default:
      return false
  }
}

Buffer.isBuffer = function (b) {
  return b && b._isBuffer
}

Buffer.byteLength = function (str, encoding) {
  switch (encoding || 'utf8') {
    case 'hex':
      return str.length / 2

    case 'utf8':
    case 'utf-8':
      return utf8ToBytes(str).length

    case 'ascii':
    case 'binary':
      return str.length

    case 'base64':
      return base64ToBytes(str).length

    default:
      throw new Error('Unknown encoding')
  }
}

Buffer.concat = function (list, totalLength) {
  if (!isArray(list)) {
    throw new Error('Usage: Buffer.concat(list, [totalLength])\n' +
        'list should be an Array.')
  }

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (typeof totalLength !== 'number') {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

// BUFFER INSTANCE METHODS
// =======================

function _hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) {
    throw new Error('Invalid hex string')
  }
  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(byte)) throw new Error('Invalid hex string')
    buf[offset + i] = byte
  }
  Buffer._charsWritten = i * 2
  return i
}

function _utf8Write (buf, string, offset, length) {
  var bytes, pos
  return Buffer._charsWritten = blitBuffer(utf8ToBytes(string), buf, offset, length)
}

function _asciiWrite (buf, string, offset, length) {
  var bytes, pos
  return Buffer._charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
}

function _binaryWrite (buf, string, offset, length) {
  return _asciiWrite(buf, string, offset, length)
}

function _base64Write (buf, string, offset, length) {
  var bytes, pos
  return Buffer._charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  switch (encoding) {
    case 'hex':
      return _hexWrite(this, string, offset, length)

    case 'utf8':
    case 'utf-8':
      return _utf8Write(this, string, offset, length)

    case 'ascii':
      return _asciiWrite(this, string, offset, length)

    case 'binary':
      return _binaryWrite(this, string, offset, length)

    case 'base64':
      return _base64Write(this, string, offset, length)

    default:
      throw new Error('Unknown encoding')
  }
}

Buffer.prototype.toString = function (encoding, start, end) {
  var self = this

  encoding = String(encoding || 'utf8').toLowerCase()
  start = Number(start) || 0
  end = (end !== undefined)
    ? Number(end)
    : end = self.length

  // Fastpath empty strings
  if (end === start)
    return ''

  switch (encoding) {
    case 'hex':
      return _hexSlice(self, start, end)

    case 'utf8':
    case 'utf-8':
      return _utf8Slice(self, start, end)

    case 'ascii':
      return _asciiSlice(self, start, end)

    case 'binary':
      return _binarySlice(self, start, end)

    case 'base64':
      return _base64Slice(self, start, end)

    default:
      throw new Error('Unknown encoding')
  }
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  if (end < start)
    throw new Error('sourceEnd < sourceStart')
  if (target_start < 0 || target_start >= target.length)
    throw new Error('targetStart out of bounds')
  if (start < 0 || start >= source.length)
    throw new Error('sourceStart out of bounds')
  if (end < 0 || end > source.length)
    throw new Error('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  // copy!
  for (var i = 0; i < end - start; i++)
    target[i + target_start] = this[i + start]
}

function _base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function _utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function _asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++)
    ret += String.fromCharCode(buf[i])
  return ret
}

function _binarySlice (buf, start, end) {
  return _asciiSlice(buf, start, end)
}

function _hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

// TODO: add test that modifying the new buffer slice will modify memory in the
// original buffer! Use code from:
// http://nodejs.org/api/buffer.html#buffer_buf_slice_start_end
Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = clamp(start, len, 0)
  end = clamp(end, len, len)

  if (browserSupport) {
    return augment(this.subarray(start, end))
  } else {
    // TODO: slicing works, with limitations (no parent tracking/update)
    // https://github.com/feross/native-buffer-browserify/issues/9
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  var buf = this
  if (!noAssert) {
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < buf.length, 'Trying to read beyond buffer length')
  }

  if (offset >= buf.length)
    return

  return buf[offset]
}

function _readUInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  if (browserSupport) {
    if (offset + 1 < len) {
      return buf._dataview.getUint16(offset, littleEndian)
    } else {
      var dv = new DataView(new ArrayBuffer(2))
      dv.setUint8(0, buf[len - 1])
      return dv.getUint16(0, littleEndian)
    }
  } else {
    var val
    if (littleEndian) {
      val = buf[offset]
      if (offset + 1 < len)
        val |= buf[offset + 1] << 8
    } else {
      val = buf[offset] << 8
      if (offset + 1 < len)
        val |= buf[offset + 1]
    }
    return val
  }
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  return _readUInt16(this, offset, true, noAssert)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  return _readUInt16(this, offset, false, noAssert)
}

function _readUInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  if (browserSupport) {
    if (offset + 3 < len) {
      return buf._dataview.getUint32(offset, littleEndian)
    } else {
      var dv = new DataView(new ArrayBuffer(4))
      for (var i = 0; i + offset < len; i++) {
        dv.setUint8(i, buf[i + offset])
      }
      return dv.getUint32(0, littleEndian)
    }
  } else {
    var val
    if (littleEndian) {
      if (offset + 2 < len)
        val = buf[offset + 2] << 16
      if (offset + 1 < len)
        val |= buf[offset + 1] << 8
      val |= buf[offset]
      if (offset + 3 < len)
        val = val + (buf[offset + 3] << 24 >>> 0)
    } else {
      if (offset + 1 < len)
        val = buf[offset + 1] << 16
      if (offset + 2 < len)
        val |= buf[offset + 2] << 8
      if (offset + 3 < len)
        val |= buf[offset + 3]
      val = val + (buf[offset] << 24 >>> 0)
    }
    return val
  }
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  return _readUInt32(this, offset, true, noAssert)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  return _readUInt32(this, offset, false, noAssert)
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  var buf = this
  if (!noAssert) {
    assert(offset !== undefined && offset !== null,
        'missing offset')
    assert(offset < buf.length, 'Trying to read beyond buffer length')
  }

  if (offset >= buf.length)
    return

  if (browserSupport) {
    return buf._dataview.getInt8(offset)
  } else {
    var neg = buf[offset] & 0x80
    if (neg)
      return (0xff - buf[offset] + 1) * -1
    else
      return buf[offset]
  }
}

function _readInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  if (browserSupport) {
    if (offset + 1 === len) {
      var dv = new DataView(new ArrayBuffer(2))
      dv.setUint8(0, buf[len - 1])
      return dv.getInt16(0, littleEndian)
    } else {
      return buf._dataview.getInt16(offset, littleEndian)
    }
  } else {
    var val = _readUInt16(buf, offset, littleEndian, true)
    var neg = val & 0x8000
    if (neg)
      return (0xffff - val + 1) * -1
    else
      return val
  }
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  return _readInt16(this, offset, true, noAssert)
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  return _readInt16(this, offset, false, noAssert)
}

function _readInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  if (browserSupport) {
    if (offset + 3 >= len) {
      var dv = new DataView(new ArrayBuffer(4))
      for (var i = 0; i + offset < len; i++) {
        dv.setUint8(i, buf[i + offset])
      }
      return dv.getInt32(0, littleEndian)
    } else {
      return buf._dataview.getInt32(offset, littleEndian)
    }
  } else {
    var val = _readUInt32(buf, offset, littleEndian, true)
    var neg = val & 0x80000000
    if (neg)
      return (0xffffffff - val + 1) * -1
    else
      return val
  }
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  return _readInt32(this, offset, true, noAssert)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  return _readInt32(this, offset, false, noAssert)
}

function _readFloat (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  if (browserSupport) {
    return buf._dataview.getFloat32(offset, littleEndian)
  } else {
    return ieee754.read(buf, offset, littleEndian, 23, 4)
  }
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  return _readFloat(this, offset, true, noAssert)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  return _readFloat(this, offset, false, noAssert)
}

function _readDouble (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 7 < buf.length, 'Trying to read beyond buffer length')
  }

  if (browserSupport) {
    return buf._dataview.getFloat64(offset, littleEndian)
  } else {
    return ieee754.read(buf, offset, littleEndian, 52, 8)
  }
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  return _readDouble(this, offset, true, noAssert)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  return _readDouble(this, offset, false, noAssert)
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  var buf = this
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xff)
  }

  if (offset >= buf.length) return

  buf[offset] = value
}

function _writeUInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (browserSupport) {
    if (offset + 1 === len) {
      var dv = new DataView(new ArrayBuffer(2))
      dv.setUint16(0, value, littleEndian)
      buf[offset] = dv.getUint8(0)
    } else {
      buf._dataview.setUint16(offset, value, littleEndian)
    }
  } else {
    for (var i = 0, j = Math.min(len - offset, 2); i < j; i++) {
      buf[offset + i] =
          (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
              (littleEndian ? i : 1 - i) * 8
    }
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, false, noAssert)
}

function _writeUInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffffffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  var i
  if (browserSupport) {
    if (offset + 3 >= len) {
      var dv = new DataView(new ArrayBuffer(4))
      dv.setUint32(0, value, littleEndian)
      for (i = 0; i + offset < len; i++) {
        buf[i + offset] = dv.getUint8(i)
      }
    } else {
      buf._dataview.setUint32(offset, value, littleEndian)
    }
  } else {
    for (i = 0, j = Math.min(len - offset, 4); i < j; i++) {
      buf[offset + i] =
          (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
    }
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, false, noAssert)
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  var buf = this
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7f, -0x80)
  }

  if (offset >= buf.length)
    return

  if (browserSupport) {
    buf._dataview.setInt8(offset, value)
  } else {
    if (value >= 0)
      buf.writeUInt8(value, offset, noAssert)
    else
      buf.writeUInt8(0xff + value + 1, offset, noAssert)
  }
}

function _writeInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fff, -0x8000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (browserSupport) {
    if (offset + 1 === len) {
      var dv = new DataView(new ArrayBuffer(2))
      dv.setInt16(0, value, littleEndian)
      buf[offset] = dv.getUint8(0)
    } else {
      buf._dataview.setInt16(offset, value, littleEndian)
    }
  } else {
    if (value >= 0)
      _writeUInt16(buf, value, offset, littleEndian, noAssert)
    else
      _writeUInt16(buf, 0xffff + value + 1, offset, littleEndian, noAssert)
  }
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, false, noAssert)
}

function _writeInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fffffff, -0x80000000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (browserSupport) {
    if (offset + 3 >= len) {
      var dv = new DataView(new ArrayBuffer(4))
      dv.setInt32(0, value, littleEndian)
      for (var i = 0; i + offset < len; i++) {
        buf[i + offset] = dv.getUint8(i)
      }
    } else {
      buf._dataview.setInt32(offset, value, littleEndian)
    }
  } else {
    if (value >= 0)
      _writeUInt32(buf, value, offset, littleEndian, noAssert)
    else
      _writeUInt32(buf, 0xffffffff + value + 1, offset, littleEndian, noAssert)
  }
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, false, noAssert)
}

function _writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (browserSupport) {
    if (offset + 3 >= len) {
      var dv = new DataView(new ArrayBuffer(4))
      dv.setFloat32(0, value, littleEndian)
      for (var i = 0; i + offset < len; i++) {
        buf[i + offset] = dv.getUint8(i)
      }
    } else {
      buf._dataview.setFloat32(offset, value, littleEndian)
    }
  } else {
    ieee754.write(buf, value, offset, littleEndian, 23, 4)
  }
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, false, noAssert)
}

function _writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 7 < buf.length,
        'Trying to write beyond buffer length')
    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (browserSupport) {
    if (offset + 7 >= len) {
      var dv = new DataView(new ArrayBuffer(8))
      dv.setFloat64(0, value, littleEndian)
      for (var i = 0; i + offset < len; i++) {
        buf[i + offset] = dv.getUint8(i)
      }
    } else {
      buf._dataview.setFloat64(offset, value, littleEndian)
    }
  } else {
    ieee754.write(buf, value, offset, littleEndian, 52, 8)
  }
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, false, noAssert)
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (typeof value === 'string') {
    value = value.charCodeAt(0)
  }

  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error('value is not a number')
  }

  if (end < start) throw new Error('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) {
    throw new Error('start out of bounds')
  }

  if (end < 0 || end > this.length) {
    throw new Error('end out of bounds')
  }

  for (var i = start; i < end; i++) {
    this[i] = value
  }
}

Buffer.prototype.inspect = function () {
  var out = []
  var len = this.length
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i])
    if (i === exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...'
      break
    }
  }
  return '<Buffer ' + out.join(' ') + '>'
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Not added to Buffer.prototype since it should only
 * be available in browsers that support ArrayBuffer.
 */
function BufferToArrayBuffer () {
  return (new Buffer(this)).buffer
}

// HELPER FUNCTIONS
// ================

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

var BP = Buffer.prototype

function augment (arr) {
  arr._isBuffer = true

  // Augment the Uint8Array *instance* (not the class!) with Buffer methods
  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BufferToArrayBuffer

  if (arr.byteLength !== 0)
    arr._dataview = new DataView(arr.buffer, arr.byteOffset, arr.byteLength)

  return arr
}

// slice(start, end)
function clamp (index, len, defaultValue) {
  if (typeof index !== 'number') return defaultValue
  index = ~~index;  // Coerce to integer.
  if (index >= len) return len
  if (index >= 0) return index
  index += len
  if (index >= 0) return index
  return 0
}

function coerce (length) {
  // Coerce length to a number (possibly NaN), round up
  // in case it's fractional (e.g. 123.456) then do a
  // double negate to coerce a NaN to 0. Easy, right?
  length = ~~Math.ceil(+length)
  return length < 0 ? 0 : length
}

function isArray (subject) {
  return (Array.isArray || function (subject) {
    return Object.prototype.toString.call(subject) === '[object Array]'
  })(subject)
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++)
    if (str.charCodeAt(i) <= 0x7F)
      byteArray.push(str.charCodeAt(i))
    else {
      var h = encodeURIComponent(str.charAt(i)).substr(1).split('%')
      for (var j = 0; j < h.length; j++)
        byteArray.push(parseInt(h[j], 16))
    }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  var pos
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

/*
 * We have to make sure that the value is a valid integer. This means that it
 * is non-negative. It has no fractional component and that it does not
 * exceed the maximum allowed value.
 */
function verifuint (value, max) {
  assert(typeof value == 'number', 'cannot write a non-number as a number')
  assert(value >= 0,
      'specified a negative value for writing an unsigned value')
  assert(value <= max, 'value is larger than maximum value for type')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifsint(value, max, min) {
  assert(typeof value == 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifIEEE754(value, max, min) {
  assert(typeof value == 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
}

function assert (test, message) {
  if (!test) throw new Error(message || 'Failed assertion')
}

},{"base64-js":3,"ieee754":4}],"native-buffer-browserify":[function(require,module,exports){
module.exports=require('PcZj9L');
},{}],3:[function(require,module,exports){
(function (exports) {
	'use strict';

	var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

	function b64ToByteArray(b64) {
		var i, j, l, tmp, placeHolders, arr;
	
		if (b64.length % 4 > 0) {
			throw 'Invalid string. Length must be a multiple of 4';
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		placeHolders = indexOf(b64, '=');
		placeHolders = placeHolders > 0 ? b64.length - placeHolders : 0;

		// base64 is 4/3 + up to two characters of the original data
		arr = [];//new Uint8Array(b64.length * 3 / 4 - placeHolders);

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length;

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (indexOf(lookup, b64.charAt(i)) << 18) | (indexOf(lookup, b64.charAt(i + 1)) << 12) | (indexOf(lookup, b64.charAt(i + 2)) << 6) | indexOf(lookup, b64.charAt(i + 3));
			arr.push((tmp & 0xFF0000) >> 16);
			arr.push((tmp & 0xFF00) >> 8);
			arr.push(tmp & 0xFF);
		}

		if (placeHolders === 2) {
			tmp = (indexOf(lookup, b64.charAt(i)) << 2) | (indexOf(lookup, b64.charAt(i + 1)) >> 4);
			arr.push(tmp & 0xFF);
		} else if (placeHolders === 1) {
			tmp = (indexOf(lookup, b64.charAt(i)) << 10) | (indexOf(lookup, b64.charAt(i + 1)) << 4) | (indexOf(lookup, b64.charAt(i + 2)) >> 2);
			arr.push((tmp >> 8) & 0xFF);
			arr.push(tmp & 0xFF);
		}

		return arr;
	}

	function uint8ToBase64(uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length;

		function tripletToBase64 (num) {
			return lookup.charAt(num >> 18 & 0x3F) + lookup.charAt(num >> 12 & 0x3F) + lookup.charAt(num >> 6 & 0x3F) + lookup.charAt(num & 0x3F);
		};

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
			output += tripletToBase64(temp);
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1];
				output += lookup.charAt(temp >> 2);
				output += lookup.charAt((temp << 4) & 0x3F);
				output += '==';
				break;
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1]);
				output += lookup.charAt(temp >> 10);
				output += lookup.charAt((temp >> 4) & 0x3F);
				output += lookup.charAt((temp << 2) & 0x3F);
				output += '=';
				break;
		}

		return output;
	}

	module.exports.toByteArray = b64ToByteArray;
	module.exports.fromByteArray = uint8ToBase64;
}());

function indexOf (arr, elt /*, from*/) {
	var len = arr.length;

	var from = Number(arguments[1]) || 0;
	from = (from < 0)
		? Math.ceil(from)
		: Math.floor(from);
	if (from < 0)
		from += len;

	for (; from < len; from++) {
		if ((typeof arr === 'string' && arr.charAt(from) === elt) ||
				(typeof arr !== 'string' && arr[from] === elt)) {
			return from;
		}
	}
	return -1;
}

},{}],4:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}]},{},[])
;;module.exports=require("native-buffer-browserify").Buffer

},{}],2:[function(require,module,exports){
var Buffer=require("__browserify_Buffer");
(function (global, module) {

  if ('undefined' == typeof module) {
    var module = { exports: {} }
      , exports = module.exports
  }

  /**
   * Exports.
   */

  module.exports = expect;
  expect.Assertion = Assertion;

  /**
   * Exports version.
   */

  expect.version = '0.1.2';

  /**
   * Possible assertion flags.
   */

  var flags = {
      not: ['to', 'be', 'have', 'include', 'only']
    , to: ['be', 'have', 'include', 'only', 'not']
    , only: ['have']
    , have: ['own']
    , be: ['an']
  };

  function expect (obj) {
    return new Assertion(obj);
  }

  /**
   * Constructor
   *
   * @api private
   */

  function Assertion (obj, flag, parent) {
    this.obj = obj;
    this.flags = {};

    if (undefined != parent) {
      this.flags[flag] = true;

      for (var i in parent.flags) {
        if (parent.flags.hasOwnProperty(i)) {
          this.flags[i] = true;
        }
      }
    }

    var $flags = flag ? flags[flag] : keys(flags)
      , self = this

    if ($flags) {
      for (var i = 0, l = $flags.length; i < l; i++) {
        // avoid recursion
        if (this.flags[$flags[i]]) continue;

        var name = $flags[i]
          , assertion = new Assertion(this.obj, name, this)

        if ('function' == typeof Assertion.prototype[name]) {
          // clone the function, make sure we dont touch the prot reference
          var old = this[name];
          this[name] = function () {
            return old.apply(self, arguments);
          }

          for (var fn in Assertion.prototype) {
            if (Assertion.prototype.hasOwnProperty(fn) && fn != name) {
              this[name][fn] = bind(assertion[fn], assertion);
            }
          }
        } else {
          this[name] = assertion;
        }
      }
    }
  };

  /**
   * Performs an assertion
   *
   * @api private
   */

  Assertion.prototype.assert = function (truth, msg, error) {
    var msg = this.flags.not ? error : msg
      , ok = this.flags.not ? !truth : truth;

    if (!ok) {
      throw new Error(msg.call(this));
    }

    this.and = new Assertion(this.obj);
  };

  /**
   * Check if the value is truthy
   *
   * @api public
   */

  Assertion.prototype.ok = function () {
    this.assert(
        !!this.obj
      , function(){ return 'expected ' + i(this.obj) + ' to be truthy' }
      , function(){ return 'expected ' + i(this.obj) + ' to be falsy' });
  };

  /**
   * Assert that the function throws.
   *
   * @param {Function|RegExp} callback, or regexp to match error string against
   * @api public
   */

  Assertion.prototype.throwError =
  Assertion.prototype.throwException = function (fn) {
    expect(this.obj).to.be.a('function');

    var thrown = false
      , not = this.flags.not

    try {
      this.obj();
    } catch (e) {
      if ('function' == typeof fn) {
        fn(e);
      } else if ('object' == typeof fn) {
        var subject = 'string' == typeof e ? e : e.message;
        if (not) {
          expect(subject).to.not.match(fn);
        } else {
          expect(subject).to.match(fn);
        }
      }
      thrown = true;
    }

    if ('object' == typeof fn && not) {
      // in the presence of a matcher, ensure the `not` only applies to
      // the matching.
      this.flags.not = false;
    }

    var name = this.obj.name || 'fn';
    this.assert(
        thrown
      , function(){ return 'expected ' + name + ' to throw an exception' }
      , function(){ return 'expected ' + name + ' not to throw an exception' });
  };

  /**
   * Checks if the array is empty.
   *
   * @api public
   */

  Assertion.prototype.empty = function () {
    var expectation;

    if ('object' == typeof this.obj && null !== this.obj && !isArray(this.obj)) {
      if ('number' == typeof this.obj.length) {
        expectation = !this.obj.length;
      } else {
        expectation = !keys(this.obj).length;
      }
    } else {
      if ('string' != typeof this.obj) {
        expect(this.obj).to.be.an('object');
      }

      expect(this.obj).to.have.property('length');
      expectation = !this.obj.length;
    }

    this.assert(
        expectation
      , function(){ return 'expected ' + i(this.obj) + ' to be empty' }
      , function(){ return 'expected ' + i(this.obj) + ' to not be empty' });
    return this;
  };

  /**
   * Checks if the obj exactly equals another.
   *
   * @api public
   */

  Assertion.prototype.be =
  Assertion.prototype.equal = function (obj) {
    this.assert(
        obj === this.obj
      , function(){ return 'expected ' + i(this.obj) + ' to equal ' + i(obj) }
      , function(){ return 'expected ' + i(this.obj) + ' to not equal ' + i(obj) });
    return this;
  };

  /**
   * Checks if the obj sortof equals another.
   *
   * @api public
   */

  Assertion.prototype.eql = function (obj) {
    this.assert(
        expect.eql(obj, this.obj)
      , function(){ return 'expected ' + i(this.obj) + ' to sort of equal ' + i(obj) }
      , function(){ return 'expected ' + i(this.obj) + ' to sort of not equal ' + i(obj) });
    return this;
  };

  /**
   * Assert within start to finish (inclusive).
   *
   * @param {Number} start
   * @param {Number} finish
   * @api public
   */

  Assertion.prototype.within = function (start, finish) {
    var range = start + '..' + finish;
    this.assert(
        this.obj >= start && this.obj <= finish
      , function(){ return 'expected ' + i(this.obj) + ' to be within ' + range }
      , function(){ return 'expected ' + i(this.obj) + ' to not be within ' + range });
    return this;
  };

  /**
   * Assert typeof / instance of
   *
   * @api public
   */

  Assertion.prototype.a =
  Assertion.prototype.an = function (type) {
    if ('string' == typeof type) {
      // proper english in error msg
      var n = /^[aeiou]/.test(type) ? 'n' : '';

      // typeof with support for 'array'
      this.assert(
          'array' == type ? isArray(this.obj) :
            'object' == type
              ? 'object' == typeof this.obj && null !== this.obj
              : type == typeof this.obj
        , function(){ return 'expected ' + i(this.obj) + ' to be a' + n + ' ' + type }
        , function(){ return 'expected ' + i(this.obj) + ' not to be a' + n + ' ' + type });
    } else {
      // instanceof
      var name = type.name || 'supplied constructor';
      this.assert(
          this.obj instanceof type
        , function(){ return 'expected ' + i(this.obj) + ' to be an instance of ' + name }
        , function(){ return 'expected ' + i(this.obj) + ' not to be an instance of ' + name });
    }

    return this;
  };

  /**
   * Assert numeric value above _n_.
   *
   * @param {Number} n
   * @api public
   */

  Assertion.prototype.greaterThan =
  Assertion.prototype.above = function (n) {
    this.assert(
        this.obj > n
      , function(){ return 'expected ' + i(this.obj) + ' to be above ' + n }
      , function(){ return 'expected ' + i(this.obj) + ' to be below ' + n });
    return this;
  };

  /**
   * Assert numeric value below _n_.
   *
   * @param {Number} n
   * @api public
   */

  Assertion.prototype.lessThan =
  Assertion.prototype.below = function (n) {
    this.assert(
        this.obj < n
      , function(){ return 'expected ' + i(this.obj) + ' to be below ' + n }
      , function(){ return 'expected ' + i(this.obj) + ' to be above ' + n });
    return this;
  };

  /**
   * Assert string value matches _regexp_.
   *
   * @param {RegExp} regexp
   * @api public
   */

  Assertion.prototype.match = function (regexp) {
    this.assert(
        regexp.exec(this.obj)
      , function(){ return 'expected ' + i(this.obj) + ' to match ' + regexp }
      , function(){ return 'expected ' + i(this.obj) + ' not to match ' + regexp });
    return this;
  };

  /**
   * Assert property "length" exists and has value of _n_.
   *
   * @param {Number} n
   * @api public
   */

  Assertion.prototype.length = function (n) {
    expect(this.obj).to.have.property('length');
    var len = this.obj.length;
    this.assert(
        n == len
      , function(){ return 'expected ' + i(this.obj) + ' to have a length of ' + n + ' but got ' + len }
      , function(){ return 'expected ' + i(this.obj) + ' to not have a length of ' + len });
    return this;
  };

  /**
   * Assert property _name_ exists, with optional _val_.
   *
   * @param {String} name
   * @param {Mixed} val
   * @api public
   */

  Assertion.prototype.property = function (name, val) {
    if (this.flags.own) {
      this.assert(
          Object.prototype.hasOwnProperty.call(this.obj, name)
        , function(){ return 'expected ' + i(this.obj) + ' to have own property ' + i(name) }
        , function(){ return 'expected ' + i(this.obj) + ' to not have own property ' + i(name) });
      return this;
    }

    if (this.flags.not && undefined !== val) {
      if (undefined === this.obj[name]) {
        throw new Error(i(this.obj) + ' has no property ' + i(name));
      }
    } else {
      var hasProp;
      try {
        hasProp = name in this.obj
      } catch (e) {
        hasProp = undefined !== this.obj[name]
      }

      this.assert(
          hasProp
        , function(){ return 'expected ' + i(this.obj) + ' to have a property ' + i(name) }
        , function(){ return 'expected ' + i(this.obj) + ' to not have a property ' + i(name) });
    }

    if (undefined !== val) {
      this.assert(
          val === this.obj[name]
        , function(){ return 'expected ' + i(this.obj) + ' to have a property ' + i(name)
          + ' of ' + i(val) + ', but got ' + i(this.obj[name]) }
        , function(){ return 'expected ' + i(this.obj) + ' to not have a property ' + i(name)
          + ' of ' + i(val) });
    }

    this.obj = this.obj[name];
    return this;
  };

  /**
   * Assert that the array contains _obj_ or string contains _obj_.
   *
   * @param {Mixed} obj|string
   * @api public
   */

  Assertion.prototype.string =
  Assertion.prototype.contain = function (obj) {
    if ('string' == typeof this.obj) {
      this.assert(
          ~this.obj.indexOf(obj)
        , function(){ return 'expected ' + i(this.obj) + ' to contain ' + i(obj) }
        , function(){ return 'expected ' + i(this.obj) + ' to not contain ' + i(obj) });
    } else {
      this.assert(
          ~indexOf(this.obj, obj)
        , function(){ return 'expected ' + i(this.obj) + ' to contain ' + i(obj) }
        , function(){ return 'expected ' + i(this.obj) + ' to not contain ' + i(obj) });
    }
    return this;
  };

  /**
   * Assert exact keys or inclusion of keys by using
   * the `.own` modifier.
   *
   * @param {Array|String ...} keys
   * @api public
   */

  Assertion.prototype.key =
  Assertion.prototype.keys = function ($keys) {
    var str
      , ok = true;

    $keys = isArray($keys)
      ? $keys
      : Array.prototype.slice.call(arguments);

    if (!$keys.length) throw new Error('keys required');

    var actual = keys(this.obj)
      , len = $keys.length;

    // Inclusion
    ok = every($keys, function (key) {
      return ~indexOf(actual, key);
    });

    // Strict
    if (!this.flags.not && this.flags.only) {
      ok = ok && $keys.length == actual.length;
    }

    // Key string
    if (len > 1) {
      $keys = map($keys, function (key) {
        return i(key);
      });
      var last = $keys.pop();
      str = $keys.join(', ') + ', and ' + last;
    } else {
      str = i($keys[0]);
    }

    // Form
    str = (len > 1 ? 'keys ' : 'key ') + str;

    // Have / include
    str = (!this.flags.only ? 'include ' : 'only have ') + str;

    // Assertion
    this.assert(
        ok
      , function(){ return 'expected ' + i(this.obj) + ' to ' + str }
      , function(){ return 'expected ' + i(this.obj) + ' to not ' + str });

    return this;
  };
  /**
   * Assert a failure.
   *
   * @param {String ...} custom message
   * @api public
   */
  Assertion.prototype.fail = function (msg) {
    msg = msg || "explicit failure";
    this.assert(false, msg, msg);
    return this;
  };

  /**
   * Function bind implementation.
   */

  function bind (fn, scope) {
    return function () {
      return fn.apply(scope, arguments);
    }
  }

  /**
   * Array every compatibility
   *
   * @see bit.ly/5Fq1N2
   * @api public
   */

  function every (arr, fn, thisObj) {
    var scope = thisObj || global;
    for (var i = 0, j = arr.length; i < j; ++i) {
      if (!fn.call(scope, arr[i], i, arr)) {
        return false;
      }
    }
    return true;
  };

  /**
   * Array indexOf compatibility.
   *
   * @see bit.ly/a5Dxa2
   * @api public
   */

  function indexOf (arr, o, i) {
    if (Array.prototype.indexOf) {
      return Array.prototype.indexOf.call(arr, o, i);
    }

    if (arr.length === undefined) {
      return -1;
    }

    for (var j = arr.length, i = i < 0 ? i + j < 0 ? 0 : i + j : i || 0
        ; i < j && arr[i] !== o; i++);

    return j <= i ? -1 : i;
  };

  // https://gist.github.com/1044128/
  var getOuterHTML = function(element) {
    if ('outerHTML' in element) return element.outerHTML;
    var ns = "http://www.w3.org/1999/xhtml";
    var container = document.createElementNS(ns, '_');
    var elemProto = (window.HTMLElement || window.Element).prototype;
    var xmlSerializer = new XMLSerializer();
    var html;
    if (document.xmlVersion) {
      return xmlSerializer.serializeToString(element);
    } else {
      container.appendChild(element.cloneNode(false));
      html = container.innerHTML.replace('><', '>' + element.innerHTML + '<');
      container.innerHTML = '';
      return html;
    }
  };

  // Returns true if object is a DOM element.
  var isDOMElement = function (object) {
    if (typeof HTMLElement === 'object') {
      return object instanceof HTMLElement;
    } else {
      return object &&
        typeof object === 'object' &&
        object.nodeType === 1 &&
        typeof object.nodeName === 'string';
    }
  };

  /**
   * Inspects an object.
   *
   * @see taken from node.js `util` module (copyright Joyent, MIT license)
   * @api private
   */

  function i (obj, showHidden, depth) {
    var seen = [];

    function stylize (str) {
      return str;
    };

    function format (value, recurseTimes) {
      // Provide a hook for user-specified inspect functions.
      // Check that value is an object with an inspect function on it
      if (value && typeof value.inspect === 'function' &&
          // Filter out the util module, it's inspect function is special
          value !== exports &&
          // Also filter out any prototype objects using the circular check.
          !(value.constructor && value.constructor.prototype === value)) {
        return value.inspect(recurseTimes);
      }

      // Primitive types cannot have properties
      switch (typeof value) {
        case 'undefined':
          return stylize('undefined', 'undefined');

        case 'string':
          var simple = '\'' + json.stringify(value).replace(/^"|"$/g, '')
                                                   .replace(/'/g, "\\'")
                                                   .replace(/\\"/g, '"') + '\'';
          return stylize(simple, 'string');

        case 'number':
          return stylize('' + value, 'number');

        case 'boolean':
          return stylize('' + value, 'boolean');
      }
      // For some reason typeof null is "object", so special case here.
      if (value === null) {
        return stylize('null', 'null');
      }

      if (isDOMElement(value)) {
        return getOuterHTML(value);
      }

      // Look up the keys of the object.
      var visible_keys = keys(value);
      var $keys = showHidden ? Object.getOwnPropertyNames(value) : visible_keys;

      // Functions without properties can be shortcutted.
      if (typeof value === 'function' && $keys.length === 0) {
        if (isRegExp(value)) {
          return stylize('' + value, 'regexp');
        } else {
          var name = value.name ? ': ' + value.name : '';
          return stylize('[Function' + name + ']', 'special');
        }
      }

      // Dates without properties can be shortcutted
      if (isDate(value) && $keys.length === 0) {
        return stylize(value.toUTCString(), 'date');
      }

      var base, type, braces;
      // Determine the object type
      if (isArray(value)) {
        type = 'Array';
        braces = ['[', ']'];
      } else {
        type = 'Object';
        braces = ['{', '}'];
      }

      // Make functions say that they are functions
      if (typeof value === 'function') {
        var n = value.name ? ': ' + value.name : '';
        base = (isRegExp(value)) ? ' ' + value : ' [Function' + n + ']';
      } else {
        base = '';
      }

      // Make dates with properties first say the date
      if (isDate(value)) {
        base = ' ' + value.toUTCString();
      }

      if ($keys.length === 0) {
        return braces[0] + base + braces[1];
      }

      if (recurseTimes < 0) {
        if (isRegExp(value)) {
          return stylize('' + value, 'regexp');
        } else {
          return stylize('[Object]', 'special');
        }
      }

      seen.push(value);

      var output = map($keys, function (key) {
        var name, str;
        if (value.__lookupGetter__) {
          if (value.__lookupGetter__(key)) {
            if (value.__lookupSetter__(key)) {
              str = stylize('[Getter/Setter]', 'special');
            } else {
              str = stylize('[Getter]', 'special');
            }
          } else {
            if (value.__lookupSetter__(key)) {
              str = stylize('[Setter]', 'special');
            }
          }
        }
        if (indexOf(visible_keys, key) < 0) {
          name = '[' + key + ']';
        }
        if (!str) {
          if (indexOf(seen, value[key]) < 0) {
            if (recurseTimes === null) {
              str = format(value[key]);
            } else {
              str = format(value[key], recurseTimes - 1);
            }
            if (str.indexOf('\n') > -1) {
              if (isArray(value)) {
                str = map(str.split('\n'), function (line) {
                  return '  ' + line;
                }).join('\n').substr(2);
              } else {
                str = '\n' + map(str.split('\n'), function (line) {
                  return '   ' + line;
                }).join('\n');
              }
            }
          } else {
            str = stylize('[Circular]', 'special');
          }
        }
        if (typeof name === 'undefined') {
          if (type === 'Array' && key.match(/^\d+$/)) {
            return str;
          }
          name = json.stringify('' + key);
          if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
            name = name.substr(1, name.length - 2);
            name = stylize(name, 'name');
          } else {
            name = name.replace(/'/g, "\\'")
                       .replace(/\\"/g, '"')
                       .replace(/(^"|"$)/g, "'");
            name = stylize(name, 'string');
          }
        }

        return name + ': ' + str;
      });

      seen.pop();

      var numLinesEst = 0;
      var length = reduce(output, function (prev, cur) {
        numLinesEst++;
        if (indexOf(cur, '\n') >= 0) numLinesEst++;
        return prev + cur.length + 1;
      }, 0);

      if (length > 50) {
        output = braces[0] +
                 (base === '' ? '' : base + '\n ') +
                 ' ' +
                 output.join(',\n  ') +
                 ' ' +
                 braces[1];

      } else {
        output = braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
      }

      return output;
    }
    return format(obj, (typeof depth === 'undefined' ? 2 : depth));
  };

  function isArray (ar) {
    return Object.prototype.toString.call(ar) == '[object Array]';
  };

  function isRegExp(re) {
    var s;
    try {
      s = '' + re;
    } catch (e) {
      return false;
    }

    return re instanceof RegExp || // easy case
           // duck-type for context-switching evalcx case
           typeof(re) === 'function' &&
           re.constructor.name === 'RegExp' &&
           re.compile &&
           re.test &&
           re.exec &&
           s.match(/^\/.*\/[gim]{0,3}$/);
  };

  function isDate(d) {
    if (d instanceof Date) return true;
    return false;
  };

  function keys (obj) {
    if (Object.keys) {
      return Object.keys(obj);
    }

    var keys = [];

    for (var i in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, i)) {
        keys.push(i);
      }
    }

    return keys;
  }

  function map (arr, mapper, that) {
    if (Array.prototype.map) {
      return Array.prototype.map.call(arr, mapper, that);
    }

    var other= new Array(arr.length);

    for (var i= 0, n = arr.length; i<n; i++)
      if (i in arr)
        other[i] = mapper.call(that, arr[i], i, arr);

    return other;
  };

  function reduce (arr, fun) {
    if (Array.prototype.reduce) {
      return Array.prototype.reduce.apply(
          arr
        , Array.prototype.slice.call(arguments, 1)
      );
    }

    var len = +this.length;

    if (typeof fun !== "function")
      throw new TypeError();

    // no value to return if no initial value and an empty array
    if (len === 0 && arguments.length === 1)
      throw new TypeError();

    var i = 0;
    if (arguments.length >= 2) {
      var rv = arguments[1];
    } else {
      do {
        if (i in this) {
          rv = this[i++];
          break;
        }

        // if array contains no values, no initial value to return
        if (++i >= len)
          throw new TypeError();
      } while (true);
    }

    for (; i < len; i++) {
      if (i in this)
        rv = fun.call(null, rv, this[i], i, this);
    }

    return rv;
  };

  /**
   * Asserts deep equality
   *
   * @see taken from node.js `assert` module (copyright Joyent, MIT license)
   * @api private
   */

  expect.eql = function eql (actual, expected) {
    // 7.1. All identical values are equivalent, as determined by ===.
    if (actual === expected) {
      return true;
    } else if ('undefined' != typeof Buffer
        && Buffer.isBuffer(actual) && Buffer.isBuffer(expected)) {
      if (actual.length != expected.length) return false;

      for (var i = 0; i < actual.length; i++) {
        if (actual[i] !== expected[i]) return false;
      }

      return true;

    // 7.2. If the expected value is a Date object, the actual value is
    // equivalent if it is also a Date object that refers to the same time.
    } else if (actual instanceof Date && expected instanceof Date) {
      return actual.getTime() === expected.getTime();

    // 7.3. Other pairs that do not both pass typeof value == "object",
    // equivalence is determined by ==.
    } else if (typeof actual != 'object' && typeof expected != 'object') {
      return actual == expected;

    // 7.4. For all other Object pairs, including Array objects, equivalence is
    // determined by having the same number of owned properties (as verified
    // with Object.prototype.hasOwnProperty.call), the same set of keys
    // (although not necessarily the same order), equivalent values for every
    // corresponding key, and an identical "prototype" property. Note: this
    // accounts for both named and indexed properties on Arrays.
    } else {
      return objEquiv(actual, expected);
    }
  }

  function isUndefinedOrNull (value) {
    return value === null || value === undefined;
  }

  function isArguments (object) {
    return Object.prototype.toString.call(object) == '[object Arguments]';
  }

  function objEquiv (a, b) {
    if (isUndefinedOrNull(a) || isUndefinedOrNull(b))
      return false;
    // an identical "prototype" property.
    if (a.prototype !== b.prototype) return false;
    //~~~I've managed to break Object.keys through screwy arguments passing.
    //   Converting to array solves the problem.
    if (isArguments(a)) {
      if (!isArguments(b)) {
        return false;
      }
      a = pSlice.call(a);
      b = pSlice.call(b);
      return expect.eql(a, b);
    }
    try{
      var ka = keys(a),
        kb = keys(b),
        key, i;
    } catch (e) {//happens when one is a string literal and the other isn't
      return false;
    }
    // having the same number of owned properties (keys incorporates hasOwnProperty)
    if (ka.length != kb.length)
      return false;
    //the same set of keys (although not necessarily the same order),
    ka.sort();
    kb.sort();
    //~~~cheap key test
    for (i = ka.length - 1; i >= 0; i--) {
      if (ka[i] != kb[i])
        return false;
    }
    //equivalent values for every corresponding key, and
    //~~~possibly expensive deep test
    for (i = ka.length - 1; i >= 0; i--) {
      key = ka[i];
      if (!expect.eql(a[key], b[key]))
         return false;
    }
    return true;
  }

  var json = (function () {
    "use strict";

    if ('object' == typeof JSON && JSON.parse && JSON.stringify) {
      return {
          parse: nativeJSON.parse
        , stringify: nativeJSON.stringify
      }
    }

    var JSON = {};

    function f(n) {
        // Format integers to have at least two digits.
        return n < 10 ? '0' + n : n;
    }

    function date(d, key) {
      return isFinite(d.valueOf()) ?
          d.getUTCFullYear()     + '-' +
          f(d.getUTCMonth() + 1) + '-' +
          f(d.getUTCDate())      + 'T' +
          f(d.getUTCHours())     + ':' +
          f(d.getUTCMinutes())   + ':' +
          f(d.getUTCSeconds())   + 'Z' : null;
    };

    var cx = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
        escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
        gap,
        indent,
        meta = {    // table of character substitutions
            '\b': '\\b',
            '\t': '\\t',
            '\n': '\\n',
            '\f': '\\f',
            '\r': '\\r',
            '"' : '\\"',
            '\\': '\\\\'
        },
        rep;


    function quote(string) {

  // If the string contains no control characters, no quote characters, and no
  // backslash characters, then we can safely slap some quotes around it.
  // Otherwise we must also replace the offending characters with safe escape
  // sequences.

        escapable.lastIndex = 0;
        return escapable.test(string) ? '"' + string.replace(escapable, function (a) {
            var c = meta[a];
            return typeof c === 'string' ? c :
                '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
        }) + '"' : '"' + string + '"';
    }


    function str(key, holder) {

  // Produce a string from holder[key].

        var i,          // The loop counter.
            k,          // The member key.
            v,          // The member value.
            length,
            mind = gap,
            partial,
            value = holder[key];

  // If the value has a toJSON method, call it to obtain a replacement value.

        if (value instanceof Date) {
            value = date(key);
        }

  // If we were called with a replacer function, then call the replacer to
  // obtain a replacement value.

        if (typeof rep === 'function') {
            value = rep.call(holder, key, value);
        }

  // What happens next depends on the value's type.

        switch (typeof value) {
        case 'string':
            return quote(value);

        case 'number':

  // JSON numbers must be finite. Encode non-finite numbers as null.

            return isFinite(value) ? String(value) : 'null';

        case 'boolean':
        case 'null':

  // If the value is a boolean or null, convert it to a string. Note:
  // typeof null does not produce 'null'. The case is included here in
  // the remote chance that this gets fixed someday.

            return String(value);

  // If the type is 'object', we might be dealing with an object or an array or
  // null.

        case 'object':

  // Due to a specification blunder in ECMAScript, typeof null is 'object',
  // so watch out for that case.

            if (!value) {
                return 'null';
            }

  // Make an array to hold the partial results of stringifying this object value.

            gap += indent;
            partial = [];

  // Is the value an array?

            if (Object.prototype.toString.apply(value) === '[object Array]') {

  // The value is an array. Stringify every element. Use null as a placeholder
  // for non-JSON values.

                length = value.length;
                for (i = 0; i < length; i += 1) {
                    partial[i] = str(i, value) || 'null';
                }

  // Join all of the elements together, separated with commas, and wrap them in
  // brackets.

                v = partial.length === 0 ? '[]' : gap ?
                    '[\n' + gap + partial.join(',\n' + gap) + '\n' + mind + ']' :
                    '[' + partial.join(',') + ']';
                gap = mind;
                return v;
            }

  // If the replacer is an array, use it to select the members to be stringified.

            if (rep && typeof rep === 'object') {
                length = rep.length;
                for (i = 0; i < length; i += 1) {
                    if (typeof rep[i] === 'string') {
                        k = rep[i];
                        v = str(k, value);
                        if (v) {
                            partial.push(quote(k) + (gap ? ': ' : ':') + v);
                        }
                    }
                }
            } else {

  // Otherwise, iterate through all of the keys in the object.

                for (k in value) {
                    if (Object.prototype.hasOwnProperty.call(value, k)) {
                        v = str(k, value);
                        if (v) {
                            partial.push(quote(k) + (gap ? ': ' : ':') + v);
                        }
                    }
                }
            }

  // Join all of the member texts together, separated with commas,
  // and wrap them in braces.

            v = partial.length === 0 ? '{}' : gap ?
                '{\n' + gap + partial.join(',\n' + gap) + '\n' + mind + '}' :
                '{' + partial.join(',') + '}';
            gap = mind;
            return v;
        }
    }

  // If the JSON object does not yet have a stringify method, give it one.

    JSON.stringify = function (value, replacer, space) {

  // The stringify method takes a value and an optional replacer, and an optional
  // space parameter, and returns a JSON text. The replacer can be a function
  // that can replace values, or an array of strings that will select the keys.
  // A default replacer method can be provided. Use of the space parameter can
  // produce text that is more easily readable.

        var i;
        gap = '';
        indent = '';

  // If the space parameter is a number, make an indent string containing that
  // many spaces.

        if (typeof space === 'number') {
            for (i = 0; i < space; i += 1) {
                indent += ' ';
            }

  // If the space parameter is a string, it will be used as the indent string.

        } else if (typeof space === 'string') {
            indent = space;
        }

  // If there is a replacer, it must be a function or an array.
  // Otherwise, throw an error.

        rep = replacer;
        if (replacer && typeof replacer !== 'function' &&
                (typeof replacer !== 'object' ||
                typeof replacer.length !== 'number')) {
            throw new Error('JSON.stringify');
        }

  // Make a fake root object containing our value under the key of ''.
  // Return the result of stringifying the value.

        return str('', {'': value});
    };

  // If the JSON object does not yet have a parse method, give it one.

    JSON.parse = function (text, reviver) {
    // The parse method takes a text and an optional reviver function, and returns
    // a JavaScript value if the text is a valid JSON text.

        var j;

        function walk(holder, key) {

    // The walk method is used to recursively walk the resulting structure so
    // that modifications can be made.

            var k, v, value = holder[key];
            if (value && typeof value === 'object') {
                for (k in value) {
                    if (Object.prototype.hasOwnProperty.call(value, k)) {
                        v = walk(value, k);
                        if (v !== undefined) {
                            value[k] = v;
                        } else {
                            delete value[k];
                        }
                    }
                }
            }
            return reviver.call(holder, key, value);
        }


    // Parsing happens in four stages. In the first stage, we replace certain
    // Unicode characters with escape sequences. JavaScript handles many characters
    // incorrectly, either silently deleting them, or treating them as line endings.

        text = String(text);
        cx.lastIndex = 0;
        if (cx.test(text)) {
            text = text.replace(cx, function (a) {
                return '\\u' +
                    ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
            });
        }

    // In the second stage, we run the text against regular expressions that look
    // for non-JSON patterns. We are especially concerned with '()' and 'new'
    // because they can cause invocation, and '=' because it can cause mutation.
    // But just to be safe, we want to reject all unexpected forms.

    // We split the second stage into 4 regexp operations in order to work around
    // crippling inefficiencies in IE's and Safari's regexp engines. First we
    // replace the JSON backslash pairs with '@' (a non-JSON character). Second, we
    // replace all simple value tokens with ']' characters. Third, we delete all
    // open brackets that follow a colon or comma or that begin the text. Finally,
    // we look to see that the remaining characters are only whitespace or ']' or
    // ',' or ':' or '{' or '}'. If that is so, then the text is safe for eval.

        if (/^[\],:{}\s]*$/
                .test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')
                    .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
                    .replace(/(?:^|:|,)(?:\s*\[)+/g, ''))) {

    // In the third stage we use the eval function to compile the text into a
    // JavaScript structure. The '{' operator is subject to a syntactic ambiguity
    // in JavaScript: it can begin a block or an object literal. We wrap the text
    // in parens to eliminate the ambiguity.

            j = eval('(' + text + ')');

    // In the optional fourth stage, we recursively walk the new structure, passing
    // each name/value pair to a reviver function for possible transformation.

            return typeof reviver === 'function' ?
                walk({'': j}, '') : j;
        }

    // If the text is not JSON parseable, then a SyntaxError is thrown.

        throw new SyntaxError('JSON.parse');
    };

    return JSON;
  })();

  if ('undefined' != typeof window) {
    window.expect = module.exports;
  }

})(
    this
  , 'undefined' != typeof module ? module : {}
  , 'undefined' != typeof exports ? exports : {}
);

},{"__browserify_Buffer":1}],3:[function(require,module,exports){
(function(global) {
  var hasOwn = Object.prototype.hasOwnProperty;

  // vm

  var IDLE = 'idle';
  var SUSPENDED = 'suspended';
  var EXECUTING = 'executing';

  function Machine() {
    this.debugInfo = null;
    this.rootFrame = null;
    this.lastEval = null;
    this.state = IDLE;
    this._events = {};
  }

  // Machine.prototype.loadProgram = function(fn) {
  //   this.program = fn;
  // };

  Machine.prototype.runProgram = function(fn, thisPtr, args) {
    if(this.state === 'SUSPENDED') {
      return;
    }

    this.state = EXECUTING;

    var stepping = this.stepping;
    var hasbp = this.hasBreakpoints;

    this.hasBreakpoints = false;
    this.stepping = false;

    var ctx = fn.$ctx = this.getContext();
    ctx.softReset();

    //if(args.length) {
      fn.apply(thisPtr, args || []);
    // }
    // else {
    //   fn();
    // }

    this.hasBreakpoints = hasbp;
    this.stepping = stepping;
    this.checkStatus(ctx);

    // clean up the function, since this property is used to tell if
    // we are inside our VM or not
    delete fn.$ctx;

    return ctx.rval;
  };

  Machine.prototype.checkStatus = function(ctx) {
    if(ctx.frame) {
      // machine was paused
      this.state = SUSPENDED;

      if(this.error) {
        this.fire('error', this.error);
        this.error = null;
      }
      else {
        this.fire('breakpoint');
      }

      this.stepping = true;
    }
    else {
      this.fire('finish');
      this.state = IDLE;
    }
  };

  Machine.prototype.on = function(event, handler) {
    var arr = this._events[event] || [];
    arr.push(handler);
    this._events[event] = arr;
  };

  Machine.prototype.off = function(event, handler) {
    var arr = this._events[event] || [];
    if(handler) {
      var i = arr.indexOf(handler);
      if(i !== -1) {
        arr.splice(i, 1);
      }
    }
    else {
      this._events[event] = [];
    }
  };

  Machine.prototype.fire = function(event, data) {
    // Events are always fired asynchronouly
    setTimeout(function() {
      var arr = this._events[event] || [];
      arr.forEach(function(handler) {
        handler(data);
      });
    }.bind(this), 0);
  };

  Machine.prototype.getTopFrame = function() {
    if(!this.rootFrame) return null;

    var top = this.rootFrame;
    while(top.child) {
      top = top.child;
    }
    return top;
  };

  Machine.prototype.getRootFrame = function() {
    return this.rootFrame;
  };

  Machine.prototype.getFrameOffset = function(i) {
    // TODO: this is really annoying, but it works for now. have to do
    // two passes
    var top = this.rootFrame;
    var count = 0;
    while(top.child) {
      top = top.child;
      count++;
    }

    if(i > count) {
      return null;
    }

    var depth = count - i;
    top = this.rootFrame;
    count = 0;
    while(top.child && count < depth) {
      top = top.child;
      count++;
    }

    return top;
  };

  // cache

  Machine.allocCache = function() {
    this.cacheSize = 30000;
    this._contexts = new Array(this.cacheSize);
    this.contextptr = 0;
    for(var i=0; i<this.cacheSize; i++) {
      this._contexts[i] = new Context();
    }
  };

  Machine.prototype.getContext = function() {
    if(this.contextptr < this.cacheSize) {
      return this._contexts[this.contextptr++];
    }
    else {
      return new Context();
    }
  };

  Machine.prototype.releaseContext = function() {
    this.contextptr--;
  };

  Machine.prototype.setDebugInfo = function(info) {
    this.debugInfo = info || new DebugInfo([]);
    this.machineBreaks = new Array(this.debugInfo.data.length);

    for(var i=0; i<this.debugInfo.data.length; i++) {
      this.machineBreaks[i] = [];
    }

    this.debugInfo.breakpoints.forEach(function(line) {
      var pos = info.lineToMachinePos(line);
      if(!pos) return;

      var machineId = pos.machineId;
      var locId = pos.locId;

      if(this.machineBreaks[machineId][locId] === undefined) {
        this.hasBreakpoints = true;
        this.machineBreaks[pos.machineId][pos.locId] = true;
      }
    }.bind(this));
  };

  Machine.prototype.begin = function(code, debugInfo) {
    var fn = new Function('VM', '$Frame', 'return ' + code.trim());
    var rootFn = fn(this, $Frame);

    this.beginFunc(rootFn, debugInfo);
  };

  Machine.prototype.beginFunc = function(func, debugInfo) {
    if(this.state === 'SUSPENDED') {
      return;
    }

    this.setDebugInfo(debugInfo);
    this.state = EXECUTING;
    this.stepping = false;

    var ctx = func.$ctx = this.getContext();
    ctx.softReset();
    func();

    // a frame should have been returned
    ctx.frame.name = '<top-level>';
    this.rootFrame = ctx.frame;
    this.checkStatus(ctx);    
  };

  Machine.prototype.continue = function() {
    if(this.rootFrame && this.state === SUSPENDED) {
      // We need to get past this instruction that has a breakpoint, so
      // turn off breakpoints and step past it, then turn them back on
      // again and execute normally
      this.stepping = true;
      this.hasBreakpoints = false;
      this.rootFrame.restore();

      var nextFrame = this.rootFrame.ctx.frame;
      this.hasBreakpoints = true;
      this.stepping = false;
      nextFrame.restore();
      this.checkStatus(nextFrame.ctx);
    }
  };

  Machine.prototype.step = function() {
    if(!this.rootFrame) return;

    this.stepping = true;
    this.hasBreakpoints = false;
    this.rootFrame.restore();
    this.hasBreakpoints = true;

    this.checkStatus(this.rootFrame.ctx);

    // rootFrame now points to the new stack
    var top = this.getTopFrame(this.rootFrame);

    if(this.state === SUSPENDED &&
       top.ctx.next === this.debugInfo.data[top.machineId].finalLoc) {
      // if it's waiting to simply return a value, go ahead and run
      // that step so the user doesn't have to step through each frame
      // return
      this.step();
    }
  };

  Machine.prototype.stepOver = function() {
    if(!this.rootFrame) return;
    var top = this.getTopFrame();
    var curloc = this.getLocation();
    var finalLoc = curloc;
    var biggest = 0;
    var locs = this.debugInfo.data[top.machineId].locs;

    // find the "biggest" expression in the function that encloses
    // this one
    Object.keys(locs).forEach(function(k) {
      var loc = locs[k];

      if(loc.start.line <= curloc.start.line &&
         loc.end.line >= curloc.end.line &&
         loc.start.column <= curloc.start.column &&
         loc.end.column >= curloc.end.column) {

        var ldiff = ((curloc.start.line - loc.start.line) +
                     (loc.end.line - curloc.end.line));
        var cdiff = ((curloc.start.column - loc.start.column) +
                     (loc.end.column - curloc.end.column));
        if(ldiff + cdiff > biggest) {
          finalLoc = loc;
          biggest = ldiff + cdiff;
        }
      }
    });

    if(finalLoc !== curloc) {
      while(this.getLocation() !== finalLoc) {
        this.step();
      }

      this.step();
    }
    else {
      this.step();
    }
  };

  Machine.prototype.evaluate = function(expr) {
    if(expr === '$_') {
      return this.lastEval;
    }
    else if(this.rootFrame) {
      var top = this.getTopFrame();
      var res = top.evaluate(this, expr);

      // fix the self-referencing pointer
      res.frame.ctx.frame = res.frame;

      // switch frames to get any updated data
      var parent = this.getFrameOffset(1);
      if(parent) {
        parent.child = res.frame;
      }
      else {
        this.rootFrame = res.frame;
      }

      this.rootFrame.name = '<top-level>';
      this.lastEval = res.result;
      return this.lastEval;
    }
  };

  Machine.prototype.isStepping = function() {
    return this.stepping;
  };

  Machine.prototype.getState = function() {
    return this.state;
  };

  Machine.prototype.getLocation = function() {
    if(!this.rootFrame || !this.debugInfo) return;

    var top = this.getTopFrame();
    return this.debugInfo.data[top.machineId].locs[top.ctx.next];
  };

  Machine.prototype.disableBreakpoints = function() {
    this.hasBreakpoints = false;
  };

  Machine.prototype.enableBreakpoints = function() {
    this.hasBreakpoints = true;
  };

  // frame

  function Frame(machineId, name, fn, scope, outerScope,
                 thisPtr, ctx, child) {
    this.machineId = machineId;
    this.name = name;
    this.fn = fn;
    this.scope = scope;
    this.outerScope = outerScope;
    this.thisPtr = thisPtr;
    this.ctx = ctx;
    this.child = child;
  }

  Frame.prototype.restore = function() {
    this.fn.$ctx = this.ctx;
    this.fn.call(this.thisPtr);
  };

  Frame.prototype.evaluate = function(machine, expr) {
    machine.evalArg = expr;
    machine.error = null;
    machine.stepping = true;

    // Convert this frame into a childless frame that will just
    // execute the eval instruction
    var savedChild = this.child;
    var ctx = new Context();
    ctx.next = -1;
    ctx.frame = this;
    this.child = null;

    this.fn.$ctx = ctx;
    this.fn.call(this.thisPtr);

    // Restore the stack
    this.child = savedChild;

    if(machine.error) {
      var err = machine.error;
      machine.error = null;
      throw err;
    }
    else {
      var newFrame = ctx.frame;
      newFrame.child = this.child;
      newFrame.ctx = this.ctx;

      return {
        result: ctx.rval,
        frame: newFrame
      };
    }
  };

  Frame.prototype.stackEach = function(func) {
    if(this.child) {
      this.child.stackEach(func);
    }
    func(this);
  };

  Frame.prototype.stackMap = function(func) {
    var res;
    if(this.child) {
      res = this.child.stackMap(func);
    }
    else {
      res = [];
    }

    res.push(func(this));
    return res;
  };

  Frame.prototype.stackReduce = function(func, acc) {
    if(this.child) {
      acc = this.child.stackReduce(func, acc);
    }

    return func(acc, this);
  };

  Frame.prototype.getLocation = function(machine) {
    return machine.debugInfo.data[this.machineId].locs[this.ctx.next];
  };

  // debug info 

  function DebugInfo(data) {
    this.data = data;
    this.breakpoints = [];
  }

  DebugInfo.fromObject = function(obj) {
    var info = new DebugInfo();
    info.data = obj.data;
    info.breakpoints = obj.breakpoints;
    return info;
  };

  DebugInfo.prototype.lineToMachinePos = function(line) {
    if(!this.data) return null;

    for(var i=0, l=this.data.length; i<l; i++) {
      var locs = this.data[i].locs;
      var keys = Object.keys(locs);

      for(var cur=0, len=keys.length; cur<len; cur++) {
        var loc = locs[keys[cur]];
        if(loc.start.line === line) {
          return {
            machineId: i,
            locId: keys[cur]
          };
        }
      }
    }

    return null;
  };

  DebugInfo.prototype.toggleBreakpoint = function(line) {
    var idx = this.breakpoints.indexOf(line);
    if(idx === -1) {
      this.breakpoints.push(line);
    }
    else {
      this.breakpoints.splice(idx, 1);
    }
  };

  // context

  function Context() {
    this.reset();
  }

  Context.prototype = {
    constructor: Context,

    reset: function(initialState) {
      this.softReset(initialState);

      // Pre-initialize at least 30 temporary variables to enable hidden
      // class optimizations for simple generators.
      for (var tempIndex = 0, tempName;
           hasOwn.call(this, tempName = "t" + tempIndex) || tempIndex < 30;
           ++tempIndex) {
        this[tempName] = null;
      }
    },

    softReset: function(initialState) {
      this.next = 0;
      this.lastNext = 0;
      this.sent = void 0;
      this.returned = void 0;
      this.state = initialState || EXECUTING;
      this.rval = void 0;
      this.tryStack = [];
      this.done = false;
      this.delegate = null;
      this.frame = null;
      this.childFrame = null;
      this.isCompiled = false;

      this.staticBreakpoint = false;
      this.stepping = false;
    },

    stop: function() {
      this.done = true;

      if (hasOwn.call(this, "thrown")) {
        var thrown = this.thrown;
        delete this.thrown;
        throw thrown;
      }

      // if(this.rval === UndefinedValue) {
      //   this.rval = undefined;
      // }

      // return this.rval;
    },

    keys: function(object) {
      return Object.keys(object).reverse();
    },

    pushTry: function(catchLoc, finallyLoc, finallyTempVar) {
      if (finallyLoc) {
        this.tryStack.push({
          finallyLoc: finallyLoc,
          finallyTempVar: finallyTempVar
        });
      }

      if (catchLoc) {
        this.tryStack.push({
          catchLoc: catchLoc
        });
      }
    },

    popCatch: function(catchLoc) {
      var lastIndex = this.tryStack.length - 1;
      var entry = this.tryStack[lastIndex];

      if (entry && entry.catchLoc === catchLoc) {
        this.tryStack.length = lastIndex;
      }
    },

    popFinally: function(finallyLoc) {
      var lastIndex = this.tryStack.length - 1;
      var entry = this.tryStack[lastIndex];

      if (!entry || !hasOwn.call(entry, "finallyLoc")) {
        entry = this.tryStack[--lastIndex];
      }

      if (entry && entry.finallyLoc === finallyLoc) {
        this.tryStack.length = lastIndex;
      }
    },

    dispatchException: function(exception) {
      var finallyEntries = [];
      var dispatched = false;

      if (this.done) {
        throw exception;
      }

      // Dispatch the exception to the "end" location by default.
      this.thrown = exception;
      this.next = "end";

      for (var i = this.tryStack.length - 1; i >= 0; --i) {
        var entry = this.tryStack[i];
        if (entry.catchLoc) {
          this.next = entry.catchLoc;
          dispatched = true;
          break;
        } else if (entry.finallyLoc) {
          finallyEntries.push(entry);
          dispatched = true;
        }
      }

      while ((entry = finallyEntries.pop())) {
        this[entry.finallyTempVar] = this.next;
        this.next = entry.finallyLoc;
      }
    },

    delegateYield: function(generator, resultName, nextLoc) {
      var info = generator.next(this.sent);

      if (info.done) {
        this.delegate = null;
        this[resultName] = info.value;
        this.next = nextLoc;

        return ContinueSentinel;
      }

      this.delegate = {
        generator: generator,
        resultName: resultName,
        nextLoc: nextLoc
      };

      return info.value;
    }
  };

  // exports

  global.$Machine = Machine;
  global.$Frame = Frame;
  global.$DebugInfo = DebugInfo;
  if(typeof exports !== 'undefined') {
    exports.$Machine = Machine;
    exports.$Frame = Frame;
    exports.$DebugInfo = DebugInfo;
  }

}).call(this, (function() { return this; })());

var __debugInfo = [{
      "finalLoc": 48,

      "locs": {
        "0": {
          "start": {
            "line": 1,
            "column": 13
          },

          "end": {
            "line": 1,
            "column": 33
          }
        },

        "9": {
          "start": {
            "line": 1,
            "column": 4
          },

          "end": {
            "line": 1,
            "column": 33
          }
        },

        "10": {
          "start": {
            "line": 1,
            "column": 4
          },

          "end": {
            "line": 1,
            "column": 33
          }
        },

        "12": {
          "start": {
            "line": 3,
            "column": 18
          },

          "end": {
            "line": 9,
            "column": 1
          }
        },

        "15": {
          "start": {
            "line": 3,
            "column": 0
          },

          "end": {
            "line": 9,
            "column": 2
          }
        },

        "24": {
          "start": {
            "line": 11,
            "column": 23
          },

          "end": {
            "line": 84,
            "column": 1
          }
        },

        "27": {
          "start": {
            "line": 11,
            "column": 0
          },

          "end": {
            "line": 84,
            "column": 2
          }
        },

        "36": {
          "start": {
            "line": 86,
            "column": 23
          },

          "end": {
            "line": 101,
            "column": 1
          }
        },

        "39": {
          "start": {
            "line": 86,
            "column": 0
          },

          "end": {
            "line": 101,
            "column": 2
          }
        }
      }
    }, {
      "finalLoc": 12,

      "locs": {
        "0": {
          "start": {
            "line": 4,
            "column": 28
          },

          "end": {
            "line": 8,
            "column": 3
          }
        },

        "3": {
          "start": {
            "line": 4,
            "column": 2
          },

          "end": {
            "line": 8,
            "column": 4
          }
        }
      }
    }, {
      "finalLoc": 63,

      "locs": {
        "0": {
          "start": {
            "line": 5,
            "column": 11
          },

          "end": {
            "line": 5,
            "column": 26
          }
        },

        "3": {
          "start": {
            "line": 5,
            "column": 4
          },

          "end": {
            "line": 5,
            "column": 27
          }
        },

        "12": {
          "start": {
            "line": 5,
            "column": 4
          },

          "end": {
            "line": 5,
            "column": 50
          }
        },

        "21": {
          "start": {
            "line": 6,
            "column": 11
          },

          "end": {
            "line": 6,
            "column": 24
          }
        },

        "24": {
          "start": {
            "line": 6,
            "column": 4
          },

          "end": {
            "line": 6,
            "column": 25
          }
        },

        "33": {
          "start": {
            "line": 6,
            "column": 4
          },

          "end": {
            "line": 6,
            "column": 48
          }
        },

        "42": {
          "start": {
            "line": 7,
            "column": 11
          },

          "end": {
            "line": 7,
            "column": 20
          }
        },

        "45": {
          "start": {
            "line": 7,
            "column": 4
          },

          "end": {
            "line": 7,
            "column": 21
          }
        },

        "54": {
          "start": {
            "line": 7,
            "column": 4
          },

          "end": {
            "line": 7,
            "column": 44
          }
        }
      }
    }, {
      "finalLoc": 84,

      "locs": {
        "0": {
          "start": {
            "line": 12,
            "column": 32
          },

          "end": {
            "line": 18,
            "column": 3
          }
        },

        "3": {
          "start": {
            "line": 12,
            "column": 2
          },

          "end": {
            "line": 18,
            "column": 4
          }
        },

        "12": {
          "start": {
            "line": 20,
            "column": 42
          },

          "end": {
            "line": 23,
            "column": 3
          }
        },

        "15": {
          "start": {
            "line": 20,
            "column": 2
          },

          "end": {
            "line": 23,
            "column": 4
          }
        },

        "24": {
          "start": {
            "line": 25,
            "column": 32
          },

          "end": {
            "line": 31,
            "column": 3
          }
        },

        "27": {
          "start": {
            "line": 25,
            "column": 2
          },

          "end": {
            "line": 31,
            "column": 4
          }
        },

        "36": {
          "start": {
            "line": 33,
            "column": 31
          },

          "end": {
            "line": 43,
            "column": 3
          }
        },

        "39": {
          "start": {
            "line": 33,
            "column": 2
          },

          "end": {
            "line": 43,
            "column": 4
          }
        },

        "48": {
          "start": {
            "line": 45,
            "column": 35
          },

          "end": {
            "line": 51,
            "column": 3
          }
        },

        "51": {
          "start": {
            "line": 45,
            "column": 2
          },

          "end": {
            "line": 51,
            "column": 4
          }
        },

        "60": {
          "start": {
            "line": 53,
            "column": 37
          },

          "end": {
            "line": 71,
            "column": 3
          }
        },

        "63": {
          "start": {
            "line": 53,
            "column": 2
          },

          "end": {
            "line": 71,
            "column": 4
          }
        },

        "72": {
          "start": {
            "line": 73,
            "column": 31
          },

          "end": {
            "line": 83,
            "column": 3
          }
        },

        "75": {
          "start": {
            "line": 73,
            "column": 2
          },

          "end": {
            "line": 83,
            "column": 4
          }
        }
      }
    }, {
      "finalLoc": 60,

      "locs": {
        "0": {
          "start": {
            "line": 13,
            "column": 8
          },

          "end": {
            "line": 13,
            "column": 14
          }
        },

        "1": {
          "start": {
            "line": 13,
            "column": 8
          },

          "end": {
            "line": 13,
            "column": 14
          }
        },

        "3": {
          "start": {
            "line": 14,
            "column": 4
          },

          "end": {
            "line": 14,
            "column": 13
          }
        },

        "12": {
          "start": {
            "line": 14,
            "column": 4
          },

          "end": {
            "line": 14,
            "column": 23
          }
        },

        "21": {
          "start": {
            "line": 15,
            "column": 4
          },

          "end": {
            "line": 15,
            "column": 13
          }
        },

        "30": {
          "start": {
            "line": 15,
            "column": 4
          },

          "end": {
            "line": 15,
            "column": 30
          }
        },

        "39": {
          "start": {
            "line": 16,
            "column": 8
          },

          "end": {
            "line": 16,
            "column": 17
          }
        },

        "40": {
          "start": {
            "line": 16,
            "column": 8
          },

          "end": {
            "line": 16,
            "column": 17
          }
        },

        "42": {
          "start": {
            "line": 17,
            "column": 4
          },

          "end": {
            "line": 17,
            "column": 13
          }
        },

        "51": {
          "start": {
            "line": 17,
            "column": 4
          },

          "end": {
            "line": 17,
            "column": 23
          }
        }
      }
    }, {
      "finalLoc": 27,

      "locs": {
        "0": {
          "start": {
            "line": 21,
            "column": 17
          },

          "end": {
            "line": 21,
            "column": 22
          }
        },

        "3": {
          "start": {
            "line": 21,
            "column": 17
          },

          "end": {
            "line": 21,
            "column": 26
          }
        },

        "6": {
          "start": {
            "line": 21,
            "column": 8
          },

          "end": {
            "line": 21,
            "column": 26
          }
        },

        "7": {
          "start": {
            "line": 21,
            "column": 8
          },

          "end": {
            "line": 21,
            "column": 26
          }
        },

        "9": {
          "start": {
            "line": 22,
            "column": 4
          },

          "end": {
            "line": 22,
            "column": 13
          }
        },

        "18": {
          "start": {
            "line": 22,
            "column": 4
          },

          "end": {
            "line": 22,
            "column": 25
          }
        }
      }
    }, {
      "finalLoc": 30,

      "locs": {
        "0": {
          "start": {
            "line": 26,
            "column": 4
          },

          "end": {
            "line": 28,
            "column": 5
          }
        },

        "1": {
          "start": {
            "line": 26,
            "column": 4
          },

          "end": {
            "line": 28,
            "column": 5
          }
        },

        "3": {
          "start": {
            "line": 30,
            "column": 11
          },

          "end": {
            "line": 30,
            "column": 17
          }
        },

        "12": {
          "start": {
            "line": 30,
            "column": 4
          },

          "end": {
            "line": 30,
            "column": 18
          }
        },

        "21": {
          "start": {
            "line": 30,
            "column": 4
          },

          "end": {
            "line": 30,
            "column": 27
          }
        }
      }
    }, {
      "finalLoc": 4,

      "locs": {
        "0": {
          "start": {
            "line": 27,
            "column": 6
          },

          "end": {
            "line": 27,
            "column": 19
          }
        }
      }
    }, {
      "finalLoc": 69,

      "locs": {
        "0": {
          "start": {
            "line": 34,
            "column": 4
          },

          "end": {
            "line": 38,
            "column": 5
          }
        },

        "1": {
          "start": {
            "line": 34,
            "column": 4
          },

          "end": {
            "line": 38,
            "column": 5
          }
        },

        "3": {
          "start": {
            "line": 40,
            "column": 12
          },

          "end": {
            "line": 40,
            "column": 18
          }
        },

        "12": {
          "start": {
            "line": 40,
            "column": 8
          },

          "end": {
            "line": 40,
            "column": 18
          }
        },

        "13": {
          "start": {
            "line": 40,
            "column": 8
          },

          "end": {
            "line": 40,
            "column": 18
          }
        },

        "15": {
          "start": {
            "line": 41,
            "column": 11
          },

          "end": {
            "line": 41,
            "column": 16
          }
        },

        "24": {
          "start": {
            "line": 41,
            "column": 4
          },

          "end": {
            "line": 41,
            "column": 17
          }
        },

        "33": {
          "start": {
            "line": 41,
            "column": 4
          },

          "end": {
            "line": 41,
            "column": 27
          }
        },

        "42": {
          "start": {
            "line": 42,
            "column": 11
          },

          "end": {
            "line": 42,
            "column": 16
          }
        },

        "51": {
          "start": {
            "line": 42,
            "column": 4
          },

          "end": {
            "line": 42,
            "column": 17
          }
        },

        "60": {
          "start": {
            "line": 42,
            "column": 4
          },

          "end": {
            "line": 42,
            "column": 27
          }
        }
      }
    }, {
      "finalLoc": 4,

      "locs": {
        "0": {
          "start": {
            "line": 35,
            "column": 6
          },

          "end": {
            "line": 37,
            "column": 8
          }
        }
      }
    }, {
      "finalLoc": 4,

      "locs": {
        "0": {
          "start": {
            "line": 36,
            "column": 8
          },

          "end": {
            "line": 36,
            "column": 21
          }
        }
      }
    }, {
      "finalLoc": 35,

      "locs": {
        "0": {
          "start": {
            "line": 46,
            "column": 8
          },

          "end": {
            "line": 46,
            "column": 13
          }
        },

        "1": {
          "start": {
            "line": 46,
            "column": 8
          },

          "end": {
            "line": 46,
            "column": 13
          }
        },

        "3": {
          "start": {
            "line": 47,
            "column": 12
          },

          "end": {
            "line": 47,
            "column": 15
          }
        },

        "4": {
          "start": {
            "line": 47,
            "column": 12
          },

          "end": {
            "line": 47,
            "column": 15
          }
        },

        "6": {
          "start": {
            "line": 47,
            "column": 17
          },

          "end": {
            "line": 47,
            "column": 22
          }
        },

        "9": {
          "start": {
            "line": 48,
            "column": 6
          },

          "end": {
            "line": 48,
            "column": 9
          }
        },

        "10": {
          "start": {
            "line": 48,
            "column": 6
          },

          "end": {
            "line": 48,
            "column": 9
          }
        },

        "12": {
          "start": {
            "line": 47,
            "column": 24
          },

          "end": {
            "line": 47,
            "column": 27
          }
        },

        "13": {
          "start": {
            "line": 47,
            "column": 24
          },

          "end": {
            "line": 47,
            "column": 27
          }
        },

        "17": {
          "start": {
            "line": 50,
            "column": 4
          },

          "end": {
            "line": 50,
            "column": 13
          }
        },

        "26": {
          "start": {
            "line": 50,
            "column": 4
          },

          "end": {
            "line": 50,
            "column": 24
          }
        }
      }
    }, {
      "finalLoc": 104,

      "locs": {
        "0": {
          "start": {
            "line": 54,
            "column": 8
          },

          "end": {
            "line": 54,
            "column": 13
          }
        },

        "1": {
          "start": {
            "line": 54,
            "column": 8
          },

          "end": {
            "line": 54,
            "column": 13
          }
        },

        "3": {
          "start": {
            "line": 55,
            "column": 8
          },

          "end": {
            "line": 55,
            "column": 13
          }
        },

        "4": {
          "start": {
            "line": 55,
            "column": 8
          },

          "end": {
            "line": 55,
            "column": 13
          }
        },

        "6": {
          "start": {
            "line": 56,
            "column": 10
          },

          "end": {
            "line": 56,
            "column": 17
          }
        },

        "9": {
          "start": {
            "line": 57,
            "column": 6
          },

          "end": {
            "line": 57,
            "column": 9
          }
        },

        "10": {
          "start": {
            "line": 57,
            "column": 6
          },

          "end": {
            "line": 57,
            "column": 9
          }
        },

        "12": {
          "start": {
            "line": 58,
            "column": 6
          },

          "end": {
            "line": 58,
            "column": 9
          }
        },

        "13": {
          "start": {
            "line": 58,
            "column": 6
          },

          "end": {
            "line": 58,
            "column": 9
          }
        },

        "17": {
          "start": {
            "line": 60,
            "column": 4
          },

          "end": {
            "line": 60,
            "column": 13
          }
        },

        "26": {
          "start": {
            "line": 60,
            "column": 4
          },

          "end": {
            "line": 60,
            "column": 24
          }
        },

        "35": {
          "start": {
            "line": 61,
            "column": 4
          },

          "end": {
            "line": 61,
            "column": 13
          }
        },

        "44": {
          "start": {
            "line": 61,
            "column": 4
          },

          "end": {
            "line": 61,
            "column": 24
          }
        },

        "53": {
          "start": {
            "line": 63,
            "column": 4
          },

          "end": {
            "line": 63,
            "column": 9
          }
        },

        "54": {
          "start": {
            "line": 63,
            "column": 4
          },

          "end": {
            "line": 63,
            "column": 9
          }
        },

        "56": {
          "start": {
            "line": 64,
            "column": 4
          },

          "end": {
            "line": 64,
            "column": 9
          }
        },

        "57": {
          "start": {
            "line": 64,
            "column": 4
          },

          "end": {
            "line": 64,
            "column": 9
          }
        },

        "59": {
          "start": {
            "line": 66,
            "column": 6
          },

          "end": {
            "line": 66,
            "column": 9
          }
        },

        "60": {
          "start": {
            "line": 66,
            "column": 6
          },

          "end": {
            "line": 66,
            "column": 9
          }
        },

        "62": {
          "start": {
            "line": 67,
            "column": 6
          },

          "end": {
            "line": 67,
            "column": 9
          }
        },

        "63": {
          "start": {
            "line": 67,
            "column": 6
          },

          "end": {
            "line": 67,
            "column": 9
          }
        },

        "65": {
          "start": {
            "line": 68,
            "column": 12
          },

          "end": {
            "line": 68,
            "column": 19
          }
        },

        "68": {
          "start": {
            "line": 69,
            "column": 4
          },

          "end": {
            "line": 69,
            "column": 13
          }
        },

        "77": {
          "start": {
            "line": 69,
            "column": 4
          },

          "end": {
            "line": 69,
            "column": 24
          }
        },

        "86": {
          "start": {
            "line": 70,
            "column": 4
          },

          "end": {
            "line": 70,
            "column": 13
          }
        },

        "95": {
          "start": {
            "line": 70,
            "column": 4
          },

          "end": {
            "line": 70,
            "column": 24
          }
        }
      }
    }, {
      "finalLoc": 45,

      "locs": {
        "0": {
          "start": {
            "line": 77,
            "column": 4
          },

          "end": {
            "line": 79,
            "column": 5
          }
        },

        "1": {
          "start": {
            "line": 77,
            "column": 4
          },

          "end": {
            "line": 79,
            "column": 5
          }
        },

        "3": {
          "start": {
            "line": 74,
            "column": 8
          },

          "end": {
            "line": 74,
            "column": 29
          }
        },

        "4": {
          "start": {
            "line": 74,
            "column": 8
          },

          "end": {
            "line": 74,
            "column": 29
          }
        },

        "6": {
          "start": {
            "line": 75,
            "column": 4
          },

          "end": {
            "line": 75,
            "column": 22
          }
        },

        "15": {
          "start": {
            "line": 75,
            "column": 4
          },

          "end": {
            "line": 75,
            "column": 34
          }
        },

        "24": {
          "start": {
            "line": 81,
            "column": 8
          },

          "end": {
            "line": 81,
            "column": 24
          }
        },

        "25": {
          "start": {
            "line": 81,
            "column": 8
          },

          "end": {
            "line": 81,
            "column": 24
          }
        },

        "27": {
          "start": {
            "line": 82,
            "column": 4
          },

          "end": {
            "line": 82,
            "column": 17
          }
        },

        "36": {
          "start": {
            "line": 82,
            "column": 4
          },

          "end": {
            "line": 82,
            "column": 26
          }
        }
      }
    }, {
      "finalLoc": 3,

      "locs": {
        "0": {
          "start": {
            "line": 78,
            "column": 6
          },

          "end": {
            "line": 78,
            "column": 16
          }
        },

        "1": {
          "start": {
            "line": 78,
            "column": 6
          },

          "end": {
            "line": 78,
            "column": 16
          }
        }
      }
    }, {
      "finalLoc": 12,

      "locs": {
        "0": {
          "start": {
            "line": 87,
            "column": 35
          },

          "end": {
            "line": 100,
            "column": 3
          }
        },

        "3": {
          "start": {
            "line": 87,
            "column": 2
          },

          "end": {
            "line": 100,
            "column": 4
          }
        }
      }
    }, {
      "finalLoc": 24,

      "locs": {
        "0": {
          "start": {
            "line": 89,
            "column": 4
          },

          "end": {
            "line": 94,
            "column": 5
          }
        },

        "1": {
          "start": {
            "line": 89,
            "column": 4
          },

          "end": {
            "line": 94,
            "column": 5
          }
        },

        "3": {
          "start": {
            "line": 88,
            "column": 8
          },

          "end": {
            "line": 88,
            "column": 32
          }
        },

        "4": {
          "start": {
            "line": 88,
            "column": 8
          },

          "end": {
            "line": 88,
            "column": 32
          }
        },

        "6": {
          "start": {
            "line": 95,
            "column": 4
          },

          "end": {
            "line": 95,
            "column": 27
          }
        },

        "15": {
          "start": {
            "line": 99,
            "column": 4
          },

          "end": {
            "line": 99,
            "column": 34
          }
        }
      }
    }, {
      "finalLoc": 18,

      "locs": {
        "0": {
          "start": {
            "line": 90,
            "column": 10
          },

          "end": {
            "line": 90,
            "column": 15
          }
        },

        "1": {
          "start": {
            "line": 90,
            "column": 10
          },

          "end": {
            "line": 90,
            "column": 15
          }
        },

        "3": {
          "start": {
            "line": 91,
            "column": 6
          },

          "end": {
            "line": 91,
            "column": 15
          }
        },

        "6": {
          "start": {
            "line": 92,
            "column": 6
          },

          "end": {
            "line": 92,
            "column": 35
          }
        },

        "15": {
          "start": {
            "line": 93,
            "column": 6
          },

          "end": {
            "line": 93,
            "column": 11
          }
        },

        "16": {
          "start": {
            "line": 93,
            "column": 6
          },

          "end": {
            "line": 93,
            "column": 11
          }
        }
      }
    }];

function $__root() {
  var expect;
  var $ctx = $__root.$ctx;

  if ($ctx === undefined)
    return VM.runProgram($__root, this, arguments);

  $ctx.isCompiled = true;

  if ($ctx.frame) {
    expect = $ctx.frame.scope.expect;
    var $child = $ctx.frame.child;

    if ($child) {
      var $child$ctx = $child.ctx;
      $child.fn.$ctx = $child$ctx;
      $child.fn.call($child.thisPtr);

      if ($child$ctx.frame) {
        $ctx.frame.child = $child$ctx.frame;
        return;
      } else {
        $ctx.frame = null;
        $ctx.childFrame = null;
        $ctx[$ctx.resultLoc] = $child$ctx.rval;

        if (VM.stepping)
          throw null;
      }
    } else {
      if ($ctx.staticBreakpoint)
        $ctx.next = $ctx.next + 3;

      $ctx.frame = null;
      $ctx.childFrame = null;
    }
  } else if (VM.stepping)
    throw null;

  try {
    while (1) {
      if (VM.hasBreakpoints && VM.machineBreaks[0][$ctx.next] !== undefined)
        break;

      switch ($ctx.next) {
      case 0:
        var $t1 = VM.getContext();

        if (require)
          require.$ctx = $t1;

        $t1.softReset();
        var $t2 = require('expect.js');
        $ctx.next = 9;

        if ($t1.frame) {
          $ctx.childFrame = $t1.frame;
          $ctx.resultLoc = "t0";
          VM.stepping = true;
          break;
        }

        $ctx.t0 = ($t1.isCompiled ? $t1.rval : $t2);
        VM.releaseContext();
      case 9:
        expect = $ctx.t0;
        $ctx.next = 12;
      case 12:
        $ctx.t5 = function $anon1() {
          var $ctx = $anon1.$ctx;

          if ($ctx === undefined)
            return VM.runProgram($anon1, this, arguments);

          $ctx.isCompiled = true;

          if ($ctx.frame) {
            var $child = $ctx.frame.child;

            if ($child) {
              var $child$ctx = $child.ctx;
              $child.fn.$ctx = $child$ctx;
              $child.fn.call($child.thisPtr);

              if ($child$ctx.frame) {
                $ctx.frame.child = $child$ctx.frame;
                return;
              } else {
                $ctx.frame = null;
                $ctx.childFrame = null;
                $ctx[$ctx.resultLoc] = $child$ctx.rval;

                if (VM.stepping)
                  throw null;
              }
            } else {
              if ($ctx.staticBreakpoint)
                $ctx.next = $ctx.next + 3;

              $ctx.frame = null;
              $ctx.childFrame = null;
            }
          } else if (VM.stepping)
            throw null;

          try {
            while (1) {
              if (VM.hasBreakpoints && VM.machineBreaks[1][$ctx.next] !== undefined)
                break;

              switch ($ctx.next) {
              case 0:
                $ctx.t17 = function $anon2() {
                  var $ctx = $anon2.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon2, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    var $child = $ctx.frame.child;

                    if ($child) {
                      var $child$ctx = $child.ctx;
                      $child.fn.$ctx = $child$ctx;
                      $child.fn.call($child.thisPtr);

                      if ($child$ctx.frame) {
                        $ctx.frame.child = $child$ctx.frame;
                        return;
                      } else {
                        $ctx.frame = null;
                        $ctx.childFrame = null;
                        $ctx[$ctx.resultLoc] = $child$ctx.rval;

                        if (VM.stepping)
                          throw null;
                      }
                    } else {
                      if ($ctx.staticBreakpoint)
                        $ctx.next = $ctx.next + 3;

                      $ctx.frame = null;
                      $ctx.childFrame = null;
                    }
                  } else if (VM.stepping)
                    throw null;

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[2][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        $ctx.t21 = typeof $Machine;
                        $ctx.next = 3;
                      case 3:
                        var $t20 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t20;

                        $t20.softReset();
                        var $t22 = expect($ctx.t21);
                        $ctx.next = 12;

                        if ($t20.frame) {
                          $ctx.childFrame = $t20.frame;
                          $ctx.resultLoc = "t19";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t19 = ($t20.isCompiled ? $t20.rval : $t22);
                        VM.releaseContext();
                      case 12:
                        var $t24 = VM.getContext();

                        if ($ctx.t19.to.not.be)
                          $ctx.t19.to.not.be.$ctx = $t24;

                        $t24.softReset();
                        var $t25 = $ctx.t19.to.not.be('undefined');
                        $ctx.next = 21;

                        if ($t24.frame) {
                          $ctx.childFrame = $t24.frame;
                          $ctx.resultLoc = "t23";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t23 = ($t24.isCompiled ? $t24.rval : $t25);
                        VM.releaseContext();
                      case 21:
                        $ctx.t28 = typeof $Frame;
                        $ctx.next = 24;
                      case 24:
                        var $t27 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t27;

                        $t27.softReset();
                        var $t29 = expect($ctx.t28);
                        $ctx.next = 33;

                        if ($t27.frame) {
                          $ctx.childFrame = $t27.frame;
                          $ctx.resultLoc = "t26";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t26 = ($t27.isCompiled ? $t27.rval : $t29);
                        VM.releaseContext();
                      case 33:
                        var $t31 = VM.getContext();

                        if ($ctx.t26.to.not.be)
                          $ctx.t26.to.not.be.$ctx = $t31;

                        $t31.softReset();
                        var $t32 = $ctx.t26.to.not.be('undefined');
                        $ctx.next = 42;

                        if ($t31.frame) {
                          $ctx.childFrame = $t31.frame;
                          $ctx.resultLoc = "t30";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t30 = ($t31.isCompiled ? $t31.rval : $t32);
                        VM.releaseContext();
                      case 42:
                        $ctx.t35 = typeof VM;
                        $ctx.next = 45;
                      case 45:
                        var $t34 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t34;

                        $t34.softReset();
                        var $t36 = expect($ctx.t35);
                        $ctx.next = 54;

                        if ($t34.frame) {
                          $ctx.childFrame = $t34.frame;
                          $ctx.resultLoc = "t33";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t33 = ($t34.isCompiled ? $t34.rval : $t36);
                        VM.releaseContext();
                      case 54:
                        var $t38 = VM.getContext();

                        if ($ctx.t33.to.not.be)
                          $ctx.t33.to.not.be.$ctx = $t38;

                        $t38.softReset();
                        var $t39 = $ctx.t33.to.not.be('undefined');
                        $ctx.next = 63;

                        if ($t38.frame) {
                          $ctx.childFrame = $t38.frame;
                          $ctx.resultLoc = "t37";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t37 = ($t38.isCompiled ? $t38.rval : $t39);
                        VM.releaseContext();
                      default:
                      case 63:
                        $anon2.$ctx = undefined;
                        return $ctx.stop();
                      case -1:
                        $ctx.rval = eval(VM.evalArg);
                      }

                      if (VM.stepping)
                        break;
                    }
                  }catch (e) {
                    VM.error = e;
                  }

                  $ctx.frame = new $Frame(2, "$anon2", $anon2, {}, ["expect"], this, $ctx, $ctx.childFrame);
                  $anon2.$ctx = undefined;
                };

                $ctx.next = 3;
              case 3:
                var $t16 = VM.getContext();

                if (it)
                  it.$ctx = $t16;

                $t16.softReset();
                var $t18 = it('should have globals', $ctx.t17);
                $ctx.next = 12;

                if ($t16.frame) {
                  $ctx.childFrame = $t16.frame;
                  $ctx.resultLoc = "t15";
                  VM.stepping = true;
                  break;
                }

                $ctx.t15 = ($t16.isCompiled ? $t16.rval : $t18);
                VM.releaseContext();
              default:
              case 12:
                $anon1.$ctx = undefined;
                return $ctx.stop();
              case -1:
                $ctx.rval = eval(VM.evalArg);
              }

              if (VM.stepping)
                break;
            }
          }catch (e) {
            VM.error = e;
          }

          $ctx.frame = new $Frame(1, "$anon1", $anon1, {}, ["expect"], this, $ctx, $ctx.childFrame);
          $anon1.$ctx = undefined;
        };

        $ctx.next = 15;
      case 15:
        var $t4 = VM.getContext();

        if (describe)
          describe.$ctx = $t4;

        $t4.softReset();
        var $t6 = describe('setup', $ctx.t5);
        $ctx.next = 24;

        if ($t4.frame) {
          $ctx.childFrame = $t4.frame;
          $ctx.resultLoc = "t3";
          VM.stepping = true;
          break;
        }

        $ctx.t3 = ($t4.isCompiled ? $t4.rval : $t6);
        VM.releaseContext();
      case 24:
        $ctx.t9 = function $anon3() {
          var $ctx = $anon3.$ctx;

          if ($ctx === undefined)
            return VM.runProgram($anon3, this, arguments);

          $ctx.isCompiled = true;

          if ($ctx.frame) {
            var $child = $ctx.frame.child;

            if ($child) {
              var $child$ctx = $child.ctx;
              $child.fn.$ctx = $child$ctx;
              $child.fn.call($child.thisPtr);

              if ($child$ctx.frame) {
                $ctx.frame.child = $child$ctx.frame;
                return;
              } else {
                $ctx.frame = null;
                $ctx.childFrame = null;
                $ctx[$ctx.resultLoc] = $child$ctx.rval;

                if (VM.stepping)
                  throw null;
              }
            } else {
              if ($ctx.staticBreakpoint)
                $ctx.next = $ctx.next + 3;

              $ctx.frame = null;
              $ctx.childFrame = null;
            }
          } else if (VM.stepping)
            throw null;

          try {
            while (1) {
              if (VM.hasBreakpoints && VM.machineBreaks[3][$ctx.next] !== undefined)
                break;

              switch ($ctx.next) {
              case 0:
                $ctx.t42 = function $anon4() {
                  var x, y;
                  var $ctx = $anon4.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon4, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    x = $ctx.frame.scope.x;
                    y = $ctx.frame.scope.y;
                    var $child = $ctx.frame.child;

                    if ($child) {
                      var $child$ctx = $child.ctx;
                      $child.fn.$ctx = $child$ctx;
                      $child.fn.call($child.thisPtr);

                      if ($child$ctx.frame) {
                        $ctx.frame.child = $child$ctx.frame;
                        return;
                      } else {
                        $ctx.frame = null;
                        $ctx.childFrame = null;
                        $ctx[$ctx.resultLoc] = $child$ctx.rval;

                        if (VM.stepping)
                          throw null;
                      }
                    } else {
                      if ($ctx.staticBreakpoint)
                        $ctx.next = $ctx.next + 3;

                      $ctx.frame = null;
                      $ctx.childFrame = null;
                    }
                  } else if (VM.stepping)
                    throw null;

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[4][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        x = 10;
                        $ctx.next = 3;
                      case 3:
                        var $t69 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t69;

                        $t69.softReset();
                        var $t70 = expect(x);
                        $ctx.next = 12;

                        if ($t69.frame) {
                          $ctx.childFrame = $t69.frame;
                          $ctx.resultLoc = "t68";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t68 = ($t69.isCompiled ? $t69.rval : $t70);
                        VM.releaseContext();
                      case 12:
                        var $t72 = VM.getContext();

                        if ($ctx.t68.to.be)
                          $ctx.t68.to.be.$ctx = $t72;

                        $t72.softReset();
                        var $t73 = $ctx.t68.to.be(10);
                        $ctx.next = 21;

                        if ($t72.frame) {
                          $ctx.childFrame = $t72.frame;
                          $ctx.resultLoc = "t71";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t71 = ($t72.isCompiled ? $t72.rval : $t73);
                        VM.releaseContext();
                      case 21:
                        var $t75 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t75;

                        $t75.softReset();
                        var $t76 = expect(y);
                        $ctx.next = 30;

                        if ($t75.frame) {
                          $ctx.childFrame = $t75.frame;
                          $ctx.resultLoc = "t74";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t74 = ($t75.isCompiled ? $t75.rval : $t76);
                        VM.releaseContext();
                      case 30:
                        var $t78 = VM.getContext();

                        if ($ctx.t74.to.be)
                          $ctx.t74.to.be.$ctx = $t78;

                        $t78.softReset();
                        var $t79 = $ctx.t74.to.be(undefined);
                        $ctx.next = 39;

                        if ($t78.frame) {
                          $ctx.childFrame = $t78.frame;
                          $ctx.resultLoc = "t77";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t77 = ($t78.isCompiled ? $t78.rval : $t79);
                        VM.releaseContext();
                      case 39:
                        y = x + 5;
                        $ctx.next = 42;
                      case 42:
                        var $t81 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t81;

                        $t81.softReset();
                        var $t82 = expect(y);
                        $ctx.next = 51;

                        if ($t81.frame) {
                          $ctx.childFrame = $t81.frame;
                          $ctx.resultLoc = "t80";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t80 = ($t81.isCompiled ? $t81.rval : $t82);
                        VM.releaseContext();
                      case 51:
                        var $t84 = VM.getContext();

                        if ($ctx.t80.to.be)
                          $ctx.t80.to.be.$ctx = $t84;

                        $t84.softReset();
                        var $t85 = $ctx.t80.to.be(15);
                        $ctx.next = 60;

                        if ($t84.frame) {
                          $ctx.childFrame = $t84.frame;
                          $ctx.resultLoc = "t83";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t83 = ($t84.isCompiled ? $t84.rval : $t85);
                        VM.releaseContext();
                      default:
                      case 60:
                        $anon4.$ctx = undefined;
                        return $ctx.stop();
                      case -1:
                        $ctx.rval = eval(VM.evalArg);
                      }

                      if (VM.stepping)
                        break;
                    }
                  }catch (e) {
                    VM.error = e;
                  }

                  $ctx.frame = new $Frame(4, "$anon4", $anon4, {
                    "x": x,
                    "y": y
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon4.$ctx = undefined;
                };

                $ctx.next = 3;
              case 3:
                var $t41 = VM.getContext();

                if (it)
                  it.$ctx = $t41;

                $t41.softReset();
                var $t43 = it('should assign variables', $ctx.t42);
                $ctx.next = 12;

                if ($t41.frame) {
                  $ctx.childFrame = $t41.frame;
                  $ctx.resultLoc = "t40";
                  VM.stepping = true;
                  break;
                }

                $ctx.t40 = ($t41.isCompiled ? $t41.rval : $t43);
                VM.releaseContext();
              case 12:
                $ctx.t46 = function $anon5() {
                  var x;
                  var $ctx = $anon5.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon5, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    x = $ctx.frame.scope.x;
                    var $child = $ctx.frame.child;

                    if ($child) {
                      var $child$ctx = $child.ctx;
                      $child.fn.$ctx = $child$ctx;
                      $child.fn.call($child.thisPtr);

                      if ($child$ctx.frame) {
                        $ctx.frame.child = $child$ctx.frame;
                        return;
                      } else {
                        $ctx.frame = null;
                        $ctx.childFrame = null;
                        $ctx[$ctx.resultLoc] = $child$ctx.rval;

                        if (VM.stepping)
                          throw null;
                      }
                    } else {
                      if ($ctx.staticBreakpoint)
                        $ctx.next = $ctx.next + 3;

                      $ctx.frame = null;
                      $ctx.childFrame = null;
                    }
                  } else if (VM.stepping)
                    throw null;

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[5][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        $ctx.t86 = 5 / 2;
                        $ctx.next = 3;
                      case 3:
                        $ctx.t87 = $ctx.t86 * 5;
                        $ctx.next = 6;
                      case 6:
                        x = 10 + $ctx.t87;
                        $ctx.next = 9;
                      case 9:
                        var $t89 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t89;

                        $t89.softReset();
                        var $t90 = expect(x);
                        $ctx.next = 18;

                        if ($t89.frame) {
                          $ctx.childFrame = $t89.frame;
                          $ctx.resultLoc = "t88";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t88 = ($t89.isCompiled ? $t89.rval : $t90);
                        VM.releaseContext();
                      case 18:
                        var $t92 = VM.getContext();

                        if ($ctx.t88.to.be)
                          $ctx.t88.to.be.$ctx = $t92;

                        $t92.softReset();
                        var $t93 = $ctx.t88.to.be(22.5);
                        $ctx.next = 27;

                        if ($t92.frame) {
                          $ctx.childFrame = $t92.frame;
                          $ctx.resultLoc = "t91";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t91 = ($t92.isCompiled ? $t92.rval : $t93);
                        VM.releaseContext();
                      default:
                      case 27:
                        $anon5.$ctx = undefined;
                        return $ctx.stop();
                      case -1:
                        $ctx.rval = eval(VM.evalArg);
                      }

                      if (VM.stepping)
                        break;
                    }
                  }catch (e) {
                    VM.error = e;
                  }

                  $ctx.frame = new $Frame(5, "$anon5", $anon5, {
                    "x": x
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon5.$ctx = undefined;
                };

                $ctx.next = 15;
              case 15:
                var $t45 = VM.getContext();

                if (it)
                  it.$ctx = $t45;

                $t45.softReset();
                var $t47 = it('should work with binary operators', $ctx.t46);
                $ctx.next = 24;

                if ($t45.frame) {
                  $ctx.childFrame = $t45.frame;
                  $ctx.resultLoc = "t44";
                  VM.stepping = true;
                  break;
                }

                $ctx.t44 = ($t45.isCompiled ? $t45.rval : $t47);
                VM.releaseContext();
              case 24:
                $ctx.t50 = function $anon6() {
                  var foo;
                  var $ctx = $anon6.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon6, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    foo = $ctx.frame.scope.foo;
                    var $child = $ctx.frame.child;

                    if ($child) {
                      var $child$ctx = $child.ctx;
                      $child.fn.$ctx = $child$ctx;
                      $child.fn.call($child.thisPtr);

                      if ($child$ctx.frame) {
                        $ctx.frame.child = $child$ctx.frame;
                        return;
                      } else {
                        $ctx.frame = null;
                        $ctx.childFrame = null;
                        $ctx[$ctx.resultLoc] = $child$ctx.rval;

                        if (VM.stepping)
                          throw null;
                      }
                    } else {
                      if ($ctx.staticBreakpoint)
                        $ctx.next = $ctx.next + 3;

                      $ctx.frame = null;
                      $ctx.childFrame = null;
                    }
                  } else if (VM.stepping)
                    throw null;

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[6][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        foo = function foo(x) {
                          var $ctx = foo.$ctx;

                          if ($ctx === undefined)
                            return VM.runProgram(foo, this, arguments);

                          $ctx.isCompiled = true;

                          if ($ctx.frame) {
                            x = $ctx.frame.scope.x;
                            var $child = $ctx.frame.child;

                            if ($child) {
                              var $child$ctx = $child.ctx;
                              $child.fn.$ctx = $child$ctx;
                              $child.fn.call($child.thisPtr);

                              if ($child$ctx.frame) {
                                $ctx.frame.child = $child$ctx.frame;
                                return;
                              } else {
                                $ctx.frame = null;
                                $ctx.childFrame = null;
                                $ctx[$ctx.resultLoc] = $child$ctx.rval;

                                if (VM.stepping)
                                  throw null;
                              }
                            } else {
                              if ($ctx.staticBreakpoint)
                                $ctx.next = $ctx.next + 3;

                              $ctx.frame = null;
                              $ctx.childFrame = null;
                            }
                          } else if (VM.stepping)
                            throw null;

                          try {
                            while (1) {
                              if (VM.hasBreakpoints && VM.machineBreaks[7][$ctx.next] !== undefined)
                                break;

                              switch ($ctx.next) {
                              case 0:
                                $ctx.rval = x + 5;
                                delete $ctx.thrown;
                                $ctx.next = 4;
                              default:
                              case 4:
                                foo.$ctx = undefined;
                                return $ctx.stop();
                              case -1:
                                $ctx.rval = eval(VM.evalArg);
                              }

                              if (VM.stepping)
                                break;
                            }
                          }catch (e) {
                            VM.error = e;
                          }

                          $ctx.frame = new $Frame(7, "foo", foo, {
                            "x": x
                          }, ["foo", "expect"], this, $ctx, $ctx.childFrame);

                          foo.$ctx = undefined;
                        };

                        $ctx.next = 3;
                      case 3:
                        var $t97 = VM.getContext();

                        if (foo)
                          foo.$ctx = $t97;

                        $t97.softReset();
                        var $t98 = foo(2);
                        $ctx.next = 12;

                        if ($t97.frame) {
                          $ctx.childFrame = $t97.frame;
                          $ctx.resultLoc = "t96";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t96 = ($t97.isCompiled ? $t97.rval : $t98);
                        VM.releaseContext();
                      case 12:
                        var $t95 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t95;

                        $t95.softReset();
                        var $t99 = expect($ctx.t96);
                        $ctx.next = 21;

                        if ($t95.frame) {
                          $ctx.childFrame = $t95.frame;
                          $ctx.resultLoc = "t94";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t94 = ($t95.isCompiled ? $t95.rval : $t99);
                        VM.releaseContext();
                      case 21:
                        var $t101 = VM.getContext();

                        if ($ctx.t94.to.be)
                          $ctx.t94.to.be.$ctx = $t101;

                        $t101.softReset();
                        var $t102 = $ctx.t94.to.be(7);
                        $ctx.next = 30;

                        if ($t101.frame) {
                          $ctx.childFrame = $t101.frame;
                          $ctx.resultLoc = "t100";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t100 = ($t101.isCompiled ? $t101.rval : $t102);
                        VM.releaseContext();
                      default:
                      case 30:
                        $anon6.$ctx = undefined;
                        return $ctx.stop();
                      case -1:
                        $ctx.rval = eval(VM.evalArg);
                      }

                      if (VM.stepping)
                        break;
                    }
                  }catch (e) {
                    VM.error = e;
                  }

                  $ctx.frame = new $Frame(6, "$anon6", $anon6, {
                    "foo": foo
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon6.$ctx = undefined;
                };

                $ctx.next = 27;
              case 27:
                var $t49 = VM.getContext();

                if (it)
                  it.$ctx = $t49;

                $t49.softReset();
                var $t51 = it('should define functions', $ctx.t50);
                $ctx.next = 36;

                if ($t49.frame) {
                  $ctx.childFrame = $t49.frame;
                  $ctx.resultLoc = "t48";
                  VM.stepping = true;
                  break;
                }

                $ctx.t48 = ($t49.isCompiled ? $t49.rval : $t51);
                VM.releaseContext();
              case 36:
                $ctx.t54 = function $anon7() {
                  var bar, z;
                  var $ctx = $anon7.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon7, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    bar = $ctx.frame.scope.bar;
                    z = $ctx.frame.scope.z;
                    var $child = $ctx.frame.child;

                    if ($child) {
                      var $child$ctx = $child.ctx;
                      $child.fn.$ctx = $child$ctx;
                      $child.fn.call($child.thisPtr);

                      if ($child$ctx.frame) {
                        $ctx.frame.child = $child$ctx.frame;
                        return;
                      } else {
                        $ctx.frame = null;
                        $ctx.childFrame = null;
                        $ctx[$ctx.resultLoc] = $child$ctx.rval;

                        if (VM.stepping)
                          throw null;
                      }
                    } else {
                      if ($ctx.staticBreakpoint)
                        $ctx.next = $ctx.next + 3;

                      $ctx.frame = null;
                      $ctx.childFrame = null;
                    }
                  } else if (VM.stepping)
                    throw null;

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[8][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        bar = function bar(x) {
                          var $ctx = bar.$ctx;

                          if ($ctx === undefined)
                            return VM.runProgram(bar, this, arguments);

                          $ctx.isCompiled = true;

                          if ($ctx.frame) {
                            x = $ctx.frame.scope.x;
                            var $child = $ctx.frame.child;

                            if ($child) {
                              var $child$ctx = $child.ctx;
                              $child.fn.$ctx = $child$ctx;
                              $child.fn.call($child.thisPtr);

                              if ($child$ctx.frame) {
                                $ctx.frame.child = $child$ctx.frame;
                                return;
                              } else {
                                $ctx.frame = null;
                                $ctx.childFrame = null;
                                $ctx[$ctx.resultLoc] = $child$ctx.rval;

                                if (VM.stepping)
                                  throw null;
                              }
                            } else {
                              if ($ctx.staticBreakpoint)
                                $ctx.next = $ctx.next + 3;

                              $ctx.frame = null;
                              $ctx.childFrame = null;
                            }
                          } else if (VM.stepping)
                            throw null;

                          try {
                            while (1) {
                              if (VM.hasBreakpoints && VM.machineBreaks[9][$ctx.next] !== undefined)
                                break;

                              switch ($ctx.next) {
                              case 0:
                                $ctx.rval = function $anon8(y) {
                                  var $ctx = $anon8.$ctx;

                                  if ($ctx === undefined)
                                    return VM.runProgram($anon8, this, arguments);

                                  $ctx.isCompiled = true;

                                  if ($ctx.frame) {
                                    y = $ctx.frame.scope.y;
                                    var $child = $ctx.frame.child;

                                    if ($child) {
                                      var $child$ctx = $child.ctx;
                                      $child.fn.$ctx = $child$ctx;
                                      $child.fn.call($child.thisPtr);

                                      if ($child$ctx.frame) {
                                        $ctx.frame.child = $child$ctx.frame;
                                        return;
                                      } else {
                                        $ctx.frame = null;
                                        $ctx.childFrame = null;
                                        $ctx[$ctx.resultLoc] = $child$ctx.rval;

                                        if (VM.stepping)
                                          throw null;
                                      }
                                    } else {
                                      if ($ctx.staticBreakpoint)
                                        $ctx.next = $ctx.next + 3;

                                      $ctx.frame = null;
                                      $ctx.childFrame = null;
                                    }
                                  } else if (VM.stepping)
                                    throw null;

                                  try {
                                    while (1) {
                                      if (VM.hasBreakpoints && VM.machineBreaks[10][$ctx.next] !== undefined)
                                        break;

                                      switch ($ctx.next) {
                                      case 0:
                                        $ctx.rval = x + y;
                                        delete $ctx.thrown;
                                        $ctx.next = 4;
                                      default:
                                      case 4:
                                        $anon8.$ctx = undefined;
                                        return $ctx.stop();
                                      case -1:
                                        $ctx.rval = eval(VM.evalArg);
                                      }

                                      if (VM.stepping)
                                        break;
                                    }
                                  }catch (e) {
                                    VM.error = e;
                                  }

                                  $ctx.frame = new $Frame(10, "$anon8", $anon8, {
                                    "y": y
                                  }, ["x", "bar", "z", "expect"], this, $ctx, $ctx.childFrame);

                                  $anon8.$ctx = undefined;
                                };

                                delete $ctx.thrown;
                                $ctx.next = 4;
                              default:
                              case 4:
                                bar.$ctx = undefined;
                                return $ctx.stop();
                              case -1:
                                $ctx.rval = eval(VM.evalArg);
                              }

                              if (VM.stepping)
                                break;
                            }
                          }catch (e) {
                            VM.error = e;
                          }

                          $ctx.frame = new $Frame(9, "bar", bar, {
                            "x": x
                          }, ["bar", "z", "expect"], this, $ctx, $ctx.childFrame);

                          bar.$ctx = undefined;
                        };

                        $ctx.next = 3;
                      case 3:
                        var $t104 = VM.getContext();

                        if (bar)
                          bar.$ctx = $t104;

                        $t104.softReset();
                        var $t105 = bar(5);
                        $ctx.next = 12;

                        if ($t104.frame) {
                          $ctx.childFrame = $t104.frame;
                          $ctx.resultLoc = "t103";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t103 = ($t104.isCompiled ? $t104.rval : $t105);
                        VM.releaseContext();
                      case 12:
                        z = $ctx.t103;
                        $ctx.next = 15;
                      case 15:
                        var $t109 = VM.getContext();

                        if (z)
                          z.$ctx = $t109;

                        $t109.softReset();
                        var $t110 = z(10);
                        $ctx.next = 24;

                        if ($t109.frame) {
                          $ctx.childFrame = $t109.frame;
                          $ctx.resultLoc = "t108";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t108 = ($t109.isCompiled ? $t109.rval : $t110);
                        VM.releaseContext();
                      case 24:
                        var $t107 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t107;

                        $t107.softReset();
                        var $t111 = expect($ctx.t108);
                        $ctx.next = 33;

                        if ($t107.frame) {
                          $ctx.childFrame = $t107.frame;
                          $ctx.resultLoc = "t106";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t106 = ($t107.isCompiled ? $t107.rval : $t111);
                        VM.releaseContext();
                      case 33:
                        var $t113 = VM.getContext();

                        if ($ctx.t106.to.be)
                          $ctx.t106.to.be.$ctx = $t113;

                        $t113.softReset();
                        var $t114 = $ctx.t106.to.be(15);
                        $ctx.next = 42;

                        if ($t113.frame) {
                          $ctx.childFrame = $t113.frame;
                          $ctx.resultLoc = "t112";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t112 = ($t113.isCompiled ? $t113.rval : $t114);
                        VM.releaseContext();
                      case 42:
                        var $t118 = VM.getContext();

                        if (z)
                          z.$ctx = $t118;

                        $t118.softReset();
                        var $t119 = z(20);
                        $ctx.next = 51;

                        if ($t118.frame) {
                          $ctx.childFrame = $t118.frame;
                          $ctx.resultLoc = "t117";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t117 = ($t118.isCompiled ? $t118.rval : $t119);
                        VM.releaseContext();
                      case 51:
                        var $t116 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t116;

                        $t116.softReset();
                        var $t120 = expect($ctx.t117);
                        $ctx.next = 60;

                        if ($t116.frame) {
                          $ctx.childFrame = $t116.frame;
                          $ctx.resultLoc = "t115";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t115 = ($t116.isCompiled ? $t116.rval : $t120);
                        VM.releaseContext();
                      case 60:
                        var $t122 = VM.getContext();

                        if ($ctx.t115.to.be)
                          $ctx.t115.to.be.$ctx = $t122;

                        $t122.softReset();
                        var $t123 = $ctx.t115.to.be(25);
                        $ctx.next = 69;

                        if ($t122.frame) {
                          $ctx.childFrame = $t122.frame;
                          $ctx.resultLoc = "t121";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t121 = ($t122.isCompiled ? $t122.rval : $t123);
                        VM.releaseContext();
                      default:
                      case 69:
                        $anon7.$ctx = undefined;
                        return $ctx.stop();
                      case -1:
                        $ctx.rval = eval(VM.evalArg);
                      }

                      if (VM.stepping)
                        break;
                    }
                  }catch (e) {
                    VM.error = e;
                  }

                  $ctx.frame = new $Frame(8, "$anon7", $anon7, {
                    "bar": bar,
                    "z": z
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon7.$ctx = undefined;
                };

                $ctx.next = 39;
              case 39:
                var $t53 = VM.getContext();

                if (it)
                  it.$ctx = $t53;

                $t53.softReset();
                var $t55 = it('should close over data', $ctx.t54);
                $ctx.next = 48;

                if ($t53.frame) {
                  $ctx.childFrame = $t53.frame;
                  $ctx.resultLoc = "t52";
                  VM.stepping = true;
                  break;
                }

                $ctx.t52 = ($t53.isCompiled ? $t53.rval : $t55);
                VM.releaseContext();
              case 48:
                $ctx.t58 = function $anon9() {
                  var z, i;
                  var $ctx = $anon9.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon9, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    z = $ctx.frame.scope.z;
                    i = $ctx.frame.scope.i;
                    var $child = $ctx.frame.child;

                    if ($child) {
                      var $child$ctx = $child.ctx;
                      $child.fn.$ctx = $child$ctx;
                      $child.fn.call($child.thisPtr);

                      if ($child$ctx.frame) {
                        $ctx.frame.child = $child$ctx.frame;
                        return;
                      } else {
                        $ctx.frame = null;
                        $ctx.childFrame = null;
                        $ctx[$ctx.resultLoc] = $child$ctx.rval;

                        if (VM.stepping)
                          throw null;
                      }
                    } else {
                      if ($ctx.staticBreakpoint)
                        $ctx.next = $ctx.next + 3;

                      $ctx.frame = null;
                      $ctx.childFrame = null;
                    }
                  } else if (VM.stepping)
                    throw null;

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[11][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        z = 5;
                        $ctx.next = 3;
                      case 3:
                        i = 0;
                        $ctx.next = 6;
                      case 6:
                        if (!(i < 100)) {
                          $ctx.next = 17;
                          break;
                        }

                        $ctx.next = 9;
                      case 9:
                        z++;
                        $ctx.next = 12;
                      case 12:
                        i++;
                        $ctx.next = 6;
                      case 15:
                        $ctx.next = 6;
                        break;
                      case 17:
                        var $t125 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t125;

                        $t125.softReset();
                        var $t126 = expect(z);
                        $ctx.next = 26;

                        if ($t125.frame) {
                          $ctx.childFrame = $t125.frame;
                          $ctx.resultLoc = "t124";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t124 = ($t125.isCompiled ? $t125.rval : $t126);
                        VM.releaseContext();
                      case 26:
                        var $t128 = VM.getContext();

                        if ($ctx.t124.to.be)
                          $ctx.t124.to.be.$ctx = $t128;

                        $t128.softReset();
                        var $t129 = $ctx.t124.to.be(105);
                        $ctx.next = 35;

                        if ($t128.frame) {
                          $ctx.childFrame = $t128.frame;
                          $ctx.resultLoc = "t127";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t127 = ($t128.isCompiled ? $t128.rval : $t129);
                        VM.releaseContext();
                      default:
                      case 35:
                        $anon9.$ctx = undefined;
                        return $ctx.stop();
                      case -1:
                        $ctx.rval = eval(VM.evalArg);
                      }

                      if (VM.stepping)
                        break;
                    }
                  }catch (e) {
                    VM.error = e;
                  }

                  $ctx.frame = new $Frame(11, "$anon9", $anon9, {
                    "z": z,
                    "i": i
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon9.$ctx = undefined;
                };

                $ctx.next = 51;
              case 51:
                var $t57 = VM.getContext();

                if (it)
                  it.$ctx = $t57;

                $t57.softReset();
                var $t59 = it('should work with for loops', $ctx.t58);
                $ctx.next = 60;

                if ($t57.frame) {
                  $ctx.childFrame = $t57.frame;
                  $ctx.resultLoc = "t56";
                  VM.stepping = true;
                  break;
                }

                $ctx.t56 = ($t57.isCompiled ? $t57.rval : $t59);
                VM.releaseContext();
              case 60:
                $ctx.t62 = function $anon10() {
                  var z, i;
                  var $ctx = $anon10.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon10, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    z = $ctx.frame.scope.z;
                    i = $ctx.frame.scope.i;
                    var $child = $ctx.frame.child;

                    if ($child) {
                      var $child$ctx = $child.ctx;
                      $child.fn.$ctx = $child$ctx;
                      $child.fn.call($child.thisPtr);

                      if ($child$ctx.frame) {
                        $ctx.frame.child = $child$ctx.frame;
                        return;
                      } else {
                        $ctx.frame = null;
                        $ctx.childFrame = null;
                        $ctx[$ctx.resultLoc] = $child$ctx.rval;

                        if (VM.stepping)
                          throw null;
                      }
                    } else {
                      if ($ctx.staticBreakpoint)
                        $ctx.next = $ctx.next + 3;

                      $ctx.frame = null;
                      $ctx.childFrame = null;
                    }
                  } else if (VM.stepping)
                    throw null;

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[12][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        z = 5;
                        $ctx.next = 3;
                      case 3:
                        i = 0;
                        $ctx.next = 6;
                      case 6:
                        if (!(i < 100)) {
                          $ctx.next = 17;
                          break;
                        }

                        $ctx.next = 9;
                      case 9:
                        z++;
                        $ctx.next = 12;
                      case 12:
                        i++;
                        $ctx.next = 6;
                      case 15:
                        $ctx.next = 6;
                        break;
                      case 17:
                        var $t131 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t131;

                        $t131.softReset();
                        var $t132 = expect(i);
                        $ctx.next = 26;

                        if ($t131.frame) {
                          $ctx.childFrame = $t131.frame;
                          $ctx.resultLoc = "t130";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t130 = ($t131.isCompiled ? $t131.rval : $t132);
                        VM.releaseContext();
                      case 26:
                        var $t134 = VM.getContext();

                        if ($ctx.t130.to.be)
                          $ctx.t130.to.be.$ctx = $t134;

                        $t134.softReset();
                        var $t135 = $ctx.t130.to.be(100);
                        $ctx.next = 35;

                        if ($t134.frame) {
                          $ctx.childFrame = $t134.frame;
                          $ctx.resultLoc = "t133";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t133 = ($t134.isCompiled ? $t134.rval : $t135);
                        VM.releaseContext();
                      case 35:
                        var $t137 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t137;

                        $t137.softReset();
                        var $t138 = expect(z);
                        $ctx.next = 44;

                        if ($t137.frame) {
                          $ctx.childFrame = $t137.frame;
                          $ctx.resultLoc = "t136";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t136 = ($t137.isCompiled ? $t137.rval : $t138);
                        VM.releaseContext();
                      case 44:
                        var $t140 = VM.getContext();

                        if ($ctx.t136.to.be)
                          $ctx.t136.to.be.$ctx = $t140;

                        $t140.softReset();
                        var $t141 = $ctx.t136.to.be(105);
                        $ctx.next = 53;

                        if ($t140.frame) {
                          $ctx.childFrame = $t140.frame;
                          $ctx.resultLoc = "t139";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t139 = ($t140.isCompiled ? $t140.rval : $t141);
                        VM.releaseContext();
                      case 53:
                        z = 5;
                        $ctx.next = 56;
                      case 56:
                        i = 0;
                        $ctx.next = 59;
                      case 59:
                        z++;
                        $ctx.next = 62;
                      case 62:
                        i++;
                        $ctx.next = 65;
                      case 65:
                        if (i < 200) {
                          $ctx.next = 59;
                          break;
                        }

                        $ctx.next = 68;
                      case 68:
                        var $t143 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t143;

                        $t143.softReset();
                        var $t144 = expect(i);
                        $ctx.next = 77;

                        if ($t143.frame) {
                          $ctx.childFrame = $t143.frame;
                          $ctx.resultLoc = "t142";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t142 = ($t143.isCompiled ? $t143.rval : $t144);
                        VM.releaseContext();
                      case 77:
                        var $t146 = VM.getContext();

                        if ($ctx.t142.to.be)
                          $ctx.t142.to.be.$ctx = $t146;

                        $t146.softReset();
                        var $t147 = $ctx.t142.to.be(200);
                        $ctx.next = 86;

                        if ($t146.frame) {
                          $ctx.childFrame = $t146.frame;
                          $ctx.resultLoc = "t145";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t145 = ($t146.isCompiled ? $t146.rval : $t147);
                        VM.releaseContext();
                      case 86:
                        var $t149 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t149;

                        $t149.softReset();
                        var $t150 = expect(z);
                        $ctx.next = 95;

                        if ($t149.frame) {
                          $ctx.childFrame = $t149.frame;
                          $ctx.resultLoc = "t148";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t148 = ($t149.isCompiled ? $t149.rval : $t150);
                        VM.releaseContext();
                      case 95:
                        var $t152 = VM.getContext();

                        if ($ctx.t148.to.be)
                          $ctx.t148.to.be.$ctx = $t152;

                        $t152.softReset();
                        var $t153 = $ctx.t148.to.be(205);
                        $ctx.next = 104;

                        if ($t152.frame) {
                          $ctx.childFrame = $t152.frame;
                          $ctx.resultLoc = "t151";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t151 = ($t152.isCompiled ? $t152.rval : $t153);
                        VM.releaseContext();
                      default:
                      case 104:
                        $anon10.$ctx = undefined;
                        return $ctx.stop();
                      case -1:
                        $ctx.rval = eval(VM.evalArg);
                      }

                      if (VM.stepping)
                        break;
                    }
                  }catch (e) {
                    VM.error = e;
                  }

                  $ctx.frame = new $Frame(12, "$anon10", $anon10, {
                    "z": z,
                    "i": i
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon10.$ctx = undefined;
                };

                $ctx.next = 63;
              case 63:
                var $t61 = VM.getContext();

                if (it)
                  it.$ctx = $t61;

                $t61.softReset();
                var $t63 = it('should work with while loops', $ctx.t62);
                $ctx.next = 72;

                if ($t61.frame) {
                  $ctx.childFrame = $t61.frame;
                  $ctx.resultLoc = "t60";
                  VM.stepping = true;
                  break;
                }

                $ctx.t60 = ($t61.isCompiled ? $t61.rval : $t63);
                VM.releaseContext();
              case 72:
                $ctx.t66 = function $anon11() {
                  var arr, Foo, foo;
                  var $ctx = $anon11.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon11, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    arr = $ctx.frame.scope.arr;
                    Foo = $ctx.frame.scope.Foo;
                    foo = $ctx.frame.scope.foo;
                    var $child = $ctx.frame.child;

                    if ($child) {
                      var $child$ctx = $child.ctx;
                      $child.fn.$ctx = $child$ctx;
                      $child.fn.call($child.thisPtr);

                      if ($child$ctx.frame) {
                        $ctx.frame.child = $child$ctx.frame;
                        return;
                      } else {
                        $ctx.frame = null;
                        $ctx.childFrame = null;
                        $ctx[$ctx.resultLoc] = $child$ctx.rval;

                        if (VM.stepping)
                          throw null;
                      }
                    } else {
                      if ($ctx.staticBreakpoint)
                        $ctx.next = $ctx.next + 3;

                      $ctx.frame = null;
                      $ctx.childFrame = null;
                    }
                  } else if (VM.stepping)
                    throw null;

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[13][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        Foo = function Foo(x) {
                          var $ctx = Foo.$ctx;

                          if ($ctx === undefined)
                            return VM.runProgram(Foo, this, arguments);

                          $ctx.isCompiled = true;

                          if ($ctx.frame) {
                            x = $ctx.frame.scope.x;
                            var $child = $ctx.frame.child;

                            if ($child) {
                              var $child$ctx = $child.ctx;
                              $child.fn.$ctx = $child$ctx;
                              $child.fn.call($child.thisPtr);

                              if ($child$ctx.frame) {
                                $ctx.frame.child = $child$ctx.frame;
                                return;
                              } else {
                                $ctx.frame = null;
                                $ctx.childFrame = null;
                                $ctx[$ctx.resultLoc] = $child$ctx.rval;

                                if (VM.stepping)
                                  throw null;
                              }
                            } else {
                              if ($ctx.staticBreakpoint)
                                $ctx.next = $ctx.next + 3;

                              $ctx.frame = null;
                              $ctx.childFrame = null;
                            }
                          } else if (VM.stepping)
                            throw null;

                          try {
                            while (1) {
                              if (VM.hasBreakpoints && VM.machineBreaks[14][$ctx.next] !== undefined)
                                break;

                              switch ($ctx.next) {
                              case 0:
                                this.x = x;
                                $ctx.next = 3;
                              default:
                              case 3:
                                Foo.$ctx = undefined;
                                return $ctx.stop();
                              case -1:
                                $ctx.rval = eval(VM.evalArg);
                              }

                              if (VM.stepping)
                                break;
                            }
                          }catch (e) {
                            VM.error = e;
                          }

                          $ctx.frame = new $Frame(14, "Foo", Foo, {
                            "x": x
                          }, ["arr", "Foo", "foo", "expect"], this, $ctx, $ctx.childFrame);

                          Foo.$ctx = undefined;
                        };

                        $ctx.next = 3;
                      case 3:
                        arr = new Array(1000);
                        $ctx.next = 6;
                      case 6:
                        var $t155 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t155;

                        $t155.softReset();
                        var $t156 = expect(arr.length);
                        $ctx.next = 15;

                        if ($t155.frame) {
                          $ctx.childFrame = $t155.frame;
                          $ctx.resultLoc = "t154";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t154 = ($t155.isCompiled ? $t155.rval : $t156);
                        VM.releaseContext();
                      case 15:
                        var $t158 = VM.getContext();

                        if ($ctx.t154.to.be)
                          $ctx.t154.to.be.$ctx = $t158;

                        $t158.softReset();
                        var $t159 = $ctx.t154.to.be(1000);
                        $ctx.next = 24;

                        if ($t158.frame) {
                          $ctx.childFrame = $t158.frame;
                          $ctx.resultLoc = "t157";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t157 = ($t158.isCompiled ? $t158.rval : $t159);
                        VM.releaseContext();
                      case 24:
                        foo = new Foo(5);
                        $ctx.next = 27;
                      case 27:
                        var $t161 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t161;

                        $t161.softReset();
                        var $t162 = expect(foo.x);
                        $ctx.next = 36;

                        if ($t161.frame) {
                          $ctx.childFrame = $t161.frame;
                          $ctx.resultLoc = "t160";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t160 = ($t161.isCompiled ? $t161.rval : $t162);
                        VM.releaseContext();
                      case 36:
                        var $t164 = VM.getContext();

                        if ($ctx.t160.to.be)
                          $ctx.t160.to.be.$ctx = $t164;

                        $t164.softReset();
                        var $t165 = $ctx.t160.to.be(5);
                        $ctx.next = 45;

                        if ($t164.frame) {
                          $ctx.childFrame = $t164.frame;
                          $ctx.resultLoc = "t163";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t163 = ($t164.isCompiled ? $t164.rval : $t165);
                        VM.releaseContext();
                      default:
                      case 45:
                        $anon11.$ctx = undefined;
                        return $ctx.stop();
                      case -1:
                        $ctx.rval = eval(VM.evalArg);
                      }

                      if (VM.stepping)
                        break;
                    }
                  }catch (e) {
                    VM.error = e;
                  }

                  $ctx.frame = new $Frame(13, "$anon11", $anon11, {
                    "arr": arr,
                    "Foo": Foo,
                    "foo": foo
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon11.$ctx = undefined;
                };

                $ctx.next = 75;
              case 75:
                var $t65 = VM.getContext();

                if (it)
                  it.$ctx = $t65;

                $t65.softReset();
                var $t67 = it('should work with "new"', $ctx.t66);
                $ctx.next = 84;

                if ($t65.frame) {
                  $ctx.childFrame = $t65.frame;
                  $ctx.resultLoc = "t64";
                  VM.stepping = true;
                  break;
                }

                $ctx.t64 = ($t65.isCompiled ? $t65.rval : $t67);
                VM.releaseContext();
              default:
              case 84:
                $anon3.$ctx = undefined;
                return $ctx.stop();
              case -1:
                $ctx.rval = eval(VM.evalArg);
              }

              if (VM.stepping)
                break;
            }
          }catch (e) {
            VM.error = e;
          }

          $ctx.frame = new $Frame(3, "$anon3", $anon3, {}, ["expect"], this, $ctx, $ctx.childFrame);
          $anon3.$ctx = undefined;
        };

        $ctx.next = 27;
      case 27:
        var $t8 = VM.getContext();

        if (describe)
          describe.$ctx = $t8;

        $t8.softReset();
        var $t10 = describe('basic code', $ctx.t9);
        $ctx.next = 36;

        if ($t8.frame) {
          $ctx.childFrame = $t8.frame;
          $ctx.resultLoc = "t7";
          VM.stepping = true;
          break;
        }

        $ctx.t7 = ($t8.isCompiled ? $t8.rval : $t10);
        VM.releaseContext();
      case 36:
        $ctx.t13 = function $anon12() {
          var $ctx = $anon12.$ctx;

          if ($ctx === undefined)
            return VM.runProgram($anon12, this, arguments);

          $ctx.isCompiled = true;

          if ($ctx.frame) {
            var $child = $ctx.frame.child;

            if ($child) {
              var $child$ctx = $child.ctx;
              $child.fn.$ctx = $child$ctx;
              $child.fn.call($child.thisPtr);

              if ($child$ctx.frame) {
                $ctx.frame.child = $child$ctx.frame;
                return;
              } else {
                $ctx.frame = null;
                $ctx.childFrame = null;
                $ctx[$ctx.resultLoc] = $child$ctx.rval;

                if (VM.stepping)
                  throw null;
              }
            } else {
              if ($ctx.staticBreakpoint)
                $ctx.next = $ctx.next + 3;

              $ctx.frame = null;
              $ctx.childFrame = null;
            }
          } else if (VM.stepping)
            throw null;

          try {
            while (1) {
              if (VM.hasBreakpoints && VM.machineBreaks[15][$ctx.next] !== undefined)
                break;

              switch ($ctx.next) {
              case 0:
                $ctx.t168 = function $anon13() {
                  var machine, foo;
                  var $ctx = $anon13.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon13, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    machine = $ctx.frame.scope.machine;
                    foo = $ctx.frame.scope.foo;
                    var $child = $ctx.frame.child;

                    if ($child) {
                      var $child$ctx = $child.ctx;
                      $child.fn.$ctx = $child$ctx;
                      $child.fn.call($child.thisPtr);

                      if ($child$ctx.frame) {
                        $ctx.frame.child = $child$ctx.frame;
                        return;
                      } else {
                        $ctx.frame = null;
                        $ctx.childFrame = null;
                        $ctx[$ctx.resultLoc] = $child$ctx.rval;

                        if (VM.stepping)
                          throw null;
                      }
                    } else {
                      if ($ctx.staticBreakpoint)
                        $ctx.next = $ctx.next + 3;

                      $ctx.frame = null;
                      $ctx.childFrame = null;
                    }
                  } else if (VM.stepping)
                    throw null;

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[16][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        foo = function foo() {
                          var x;
                          var $ctx = foo.$ctx;

                          if ($ctx === undefined)
                            return VM.runProgram(foo, this, arguments);

                          $ctx.isCompiled = true;

                          if ($ctx.frame) {
                            x = $ctx.frame.scope.x;
                            var $child = $ctx.frame.child;

                            if ($child) {
                              var $child$ctx = $child.ctx;
                              $child.fn.$ctx = $child$ctx;
                              $child.fn.call($child.thisPtr);

                              if ($child$ctx.frame) {
                                $ctx.frame.child = $child$ctx.frame;
                                return;
                              } else {
                                $ctx.frame = null;
                                $ctx.childFrame = null;
                                $ctx[$ctx.resultLoc] = $child$ctx.rval;

                                if (VM.stepping)
                                  throw null;
                              }
                            } else {
                              if ($ctx.staticBreakpoint)
                                $ctx.next = $ctx.next + 3;

                              $ctx.frame = null;
                              $ctx.childFrame = null;
                            }
                          } else if (VM.stepping)
                            throw null;

                          try {
                            while (1) {
                              if (VM.hasBreakpoints && VM.machineBreaks[17][$ctx.next] !== undefined)
                                break;

                              switch ($ctx.next) {
                              case 0:
                                x = 1;
                                $ctx.next = 3;
                              case 3:
                                VM.stepping = true;
                                $ctx.next = 6;
                              case 6:
                                var $t177 = VM.getContext();

                                if (console.log)
                                  console.log.$ctx = $t177;

                                $t177.softReset();
                                var $t178 = console.log('FOO IS RUNNING');
                                $ctx.next = 15;

                                if ($t177.frame) {
                                  $ctx.childFrame = $t177.frame;
                                  $ctx.resultLoc = "t176";
                                  VM.stepping = true;
                                  break;
                                }

                                $ctx.t176 = ($t177.isCompiled ? $t177.rval : $t178);
                                VM.releaseContext();
                              case 15:
                                x = 2;
                                $ctx.next = 18;
                              default:
                              case 18:
                                foo.$ctx = undefined;
                                return $ctx.stop();
                              case -1:
                                $ctx.rval = eval(VM.evalArg);
                              }

                              if (VM.stepping)
                                break;
                            }
                          }catch (e) {
                            VM.error = e;
                          }

                          $ctx.frame = new $Frame(17, "foo", foo, {
                            "x": x
                          }, ["machine", "foo", "expect"], this, $ctx, $ctx.childFrame);

                          foo.$ctx = undefined;
                        };

                        $ctx.next = 3;
                      case 3:
                        machine = new $Machine();
                        $ctx.next = 6;
                      case 6:
                        var $t171 = VM.getContext();

                        if (machine.runProgram)
                          machine.runProgram.$ctx = $t171;

                        $t171.softReset();
                        var $t172 = machine.runProgram(foo);
                        $ctx.next = 15;

                        if ($t171.frame) {
                          $ctx.childFrame = $t171.frame;
                          $ctx.resultLoc = "t170";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t170 = ($t171.isCompiled ? $t171.rval : $t172);
                        VM.releaseContext();
                      case 15:
                        var $t174 = VM.getContext();

                        if (console.log)
                          console.log.$ctx = $t174;

                        $t174.softReset();
                        var $t175 = console.log(machine.rootFrame);
                        $ctx.next = 24;

                        if ($t174.frame) {
                          $ctx.childFrame = $t174.frame;
                          $ctx.resultLoc = "t173";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t173 = ($t174.isCompiled ? $t174.rval : $t175);
                        VM.releaseContext();
                      default:
                      case 24:
                        $anon13.$ctx = undefined;
                        return $ctx.stop();
                      case -1:
                        $ctx.rval = eval(VM.evalArg);
                      }

                      if (VM.stepping)
                        break;
                    }
                  }catch (e) {
                    VM.error = e;
                  }

                  $ctx.frame = new $Frame(16, "$anon13", $anon13, {
                    "machine": machine,
                    "foo": foo
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon13.$ctx = undefined;
                };

                $ctx.next = 3;
              case 3:
                var $t167 = VM.getContext();

                if (it)
                  it.$ctx = $t167;

                $t167.softReset();
                var $t169 = it('should suspend on debugger', $ctx.t168);
                $ctx.next = 12;

                if ($t167.frame) {
                  $ctx.childFrame = $t167.frame;
                  $ctx.resultLoc = "t166";
                  VM.stepping = true;
                  break;
                }

                $ctx.t166 = ($t167.isCompiled ? $t167.rval : $t169);
                VM.releaseContext();
              default:
              case 12:
                $anon12.$ctx = undefined;
                return $ctx.stop();
              case -1:
                $ctx.rval = eval(VM.evalArg);
              }

              if (VM.stepping)
                break;
            }
          }catch (e) {
            VM.error = e;
          }

          $ctx.frame = new $Frame(15, "$anon12", $anon12, {}, ["expect"], this, $ctx, $ctx.childFrame);
          $anon12.$ctx = undefined;
        };

        $ctx.next = 39;
      case 39:
        var $t12 = VM.getContext();

        if (describe)
          describe.$ctx = $t12;

        $t12.softReset();
        var $t14 = describe('suspending', $ctx.t13);
        $ctx.next = 48;

        if ($t12.frame) {
          $ctx.childFrame = $t12.frame;
          $ctx.resultLoc = "t11";
          VM.stepping = true;
          break;
        }

        $ctx.t11 = ($t12.isCompiled ? $t12.rval : $t14);
        VM.releaseContext();
      default:
        VM.stepping = true;
        break;
      case -1:
        $ctx.rval = eval(VM.evalArg);
      }

      if (VM.stepping)
        break;
    }
  }catch (e) {
    VM.error = e;
  }

  $ctx.frame = new $Frame(0, "$__root", $__root, {
    "expect": expect
  }, [], this, $ctx, $ctx.childFrame);

  $__root.$ctx = undefined;
};


var VM = new $Machine();
VM.on("error", function(e) { throw e; });
VM.beginFunc($__root, new $DebugInfo(__debugInfo));
},{"expect.js":2}]},{},[3])