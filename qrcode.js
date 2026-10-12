/*! QR Code generator for JavaScript — Copyright (c) 2009 Kazuhiko Arase, MIT license.
 * http://www.d-project.com/  ("QR Code" is a registered trademark of DENSO WAVE INCORPORATED)
 * Packaged for the browser from the qrcode-terminal distribution.
 * Adds: window.makeQR(text) -> SVG string, window.qrMatrix(text) -> boolean[][],
 *       window.decodeQR({data,width,height}) -> string|null (decoder written for SORT Inventory). */
(function () {
var __m = {};
function require(p) { return __m[p.replace("./", "")]; }
__m["QRMode"] = (function () { var module = { exports: {} };
module.exports = {
    MODE_NUMBER :       1 << 0,
    MODE_ALPHA_NUM :    1 << 1,
    MODE_8BIT_BYTE :    1 << 2,
    MODE_KANJI :        1 << 3
};

return module.exports; })();
__m["QRErrorCorrectLevel"] = (function () { var module = { exports: {} };
module.exports = {
	L : 1,
	M : 0,
	Q : 3,
	H : 2
};


return module.exports; })();
__m["QRMath"] = (function () { var module = { exports: {} };
var QRMath = {

	glog : function(n) {
	
		if (n < 1) {
			throw new Error("glog(" + n + ")");
		}
		
		return QRMath.LOG_TABLE[n];
	},
	
	gexp : function(n) {
	
		while (n < 0) {
			n += 255;
		}
	
		while (n >= 256) {
			n -= 255;
		}
	
		return QRMath.EXP_TABLE[n];
	},
	
	EXP_TABLE : new Array(256),
	
	LOG_TABLE : new Array(256)

};
	
for (var i = 0; i < 8; i++) {
	QRMath.EXP_TABLE[i] = 1 << i;
}
for (var i = 8; i < 256; i++) {
	QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4]
		^ QRMath.EXP_TABLE[i - 5]
		^ QRMath.EXP_TABLE[i - 6]
		^ QRMath.EXP_TABLE[i - 8];
}
for (var i = 0; i < 255; i++) {
	QRMath.LOG_TABLE[QRMath.EXP_TABLE[i] ] = i;
}

module.exports = QRMath;

return module.exports; })();
__m["QRPolynomial"] = (function () { var module = { exports: {} };
var QRMath = require('./QRMath');

function QRPolynomial(num, shift) {
	if (num.length === undefined) {
		throw new Error(num.length + "/" + shift);
	}

	var offset = 0;

	while (offset < num.length && num[offset] === 0) {
		offset++;
	}

	this.num = new Array(num.length - offset + shift);
	for (var i = 0; i < num.length - offset; i++) {
		this.num[i] = num[i + offset];
	}
}

QRPolynomial.prototype = {

	get : function(index) {
		return this.num[index];
	},
	
	getLength : function() {
		return this.num.length;
	},
	
	multiply : function(e) {
	
		var num = new Array(this.getLength() + e.getLength() - 1);
	
		for (var i = 0; i < this.getLength(); i++) {
			for (var j = 0; j < e.getLength(); j++) {
				num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i) ) + QRMath.glog(e.get(j) ) );
			}
		}
	
		return new QRPolynomial(num, 0);
	},
	
	mod : function(e) {
	
		if (this.getLength() - e.getLength() < 0) {
			return this;
		}
	
		var ratio = QRMath.glog(this.get(0) ) - QRMath.glog(e.get(0) );
	
		var num = new Array(this.getLength() );
		
		for (var i = 0; i < this.getLength(); i++) {
			num[i] = this.get(i);
		}
		
		for (var x = 0; x < e.getLength(); x++) {
			num[x] ^= QRMath.gexp(QRMath.glog(e.get(x) ) + ratio);
		}
	
		// recursive call
		return new QRPolynomial(num, 0).mod(e);
	}
};

module.exports = QRPolynomial;

return module.exports; })();
__m["QRMaskPattern"] = (function () { var module = { exports: {} };
module.exports = {
	PATTERN000 : 0,
	PATTERN001 : 1,
	PATTERN010 : 2,
	PATTERN011 : 3,
	PATTERN100 : 4,
	PATTERN101 : 5,
	PATTERN110 : 6,
	PATTERN111 : 7
};

return module.exports; })();
__m["QRUtil"] = (function () { var module = { exports: {} };
var QRMode = require('./QRMode');
var QRPolynomial = require('./QRPolynomial');
var QRMath = require('./QRMath');
var QRMaskPattern = require('./QRMaskPattern');

var QRUtil = {

    PATTERN_POSITION_TABLE : [
        [],
        [6, 18],
        [6, 22],
        [6, 26],
        [6, 30],
        [6, 34],
        [6, 22, 38],
        [6, 24, 42],
        [6, 26, 46],
        [6, 28, 50],
        [6, 30, 54],        
        [6, 32, 58],
        [6, 34, 62],
        [6, 26, 46, 66],
        [6, 26, 48, 70],
        [6, 26, 50, 74],
        [6, 30, 54, 78],
        [6, 30, 56, 82],
        [6, 30, 58, 86],
        [6, 34, 62, 90],
        [6, 28, 50, 72, 94],
        [6, 26, 50, 74, 98],
        [6, 30, 54, 78, 102],
        [6, 28, 54, 80, 106],
        [6, 32, 58, 84, 110],
        [6, 30, 58, 86, 114],
        [6, 34, 62, 90, 118],
        [6, 26, 50, 74, 98, 122],
        [6, 30, 54, 78, 102, 126],
        [6, 26, 52, 78, 104, 130],
        [6, 30, 56, 82, 108, 134],
        [6, 34, 60, 86, 112, 138],
        [6, 30, 58, 86, 114, 142],
        [6, 34, 62, 90, 118, 146],
        [6, 30, 54, 78, 102, 126, 150],
        [6, 24, 50, 76, 102, 128, 154],
        [6, 28, 54, 80, 106, 132, 158],
        [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166],
        [6, 30, 58, 86, 114, 142, 170]
    ],

    G15 : (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
    G18 : (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
    G15_MASK : (1 << 14) | (1 << 12) | (1 << 10)    | (1 << 4) | (1 << 1),

    getBCHTypeInfo : function(data) {
        var d = data << 10;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
            d ^= (QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) ) );    
        }
        return ( (data << 10) | d) ^ QRUtil.G15_MASK;
    },

    getBCHTypeNumber : function(data) {
        var d = data << 12;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) {
            d ^= (QRUtil.G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) ) );    
        }
        return (data << 12) | d;
    },

    getBCHDigit : function(data) {

        var digit = 0;

        while (data !== 0) {
            digit++;
            data >>>= 1;
        }

        return digit;
    },

    getPatternPosition : function(typeNumber) {
        return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
    },

    getMask : function(maskPattern, i, j) {
        
        switch (maskPattern) {
            
        case QRMaskPattern.PATTERN000 : return (i + j) % 2 === 0;
        case QRMaskPattern.PATTERN001 : return i % 2 === 0;
        case QRMaskPattern.PATTERN010 : return j % 3 === 0;
        case QRMaskPattern.PATTERN011 : return (i + j) % 3 === 0;
        case QRMaskPattern.PATTERN100 : return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 === 0;
        case QRMaskPattern.PATTERN101 : return (i * j) % 2 + (i * j) % 3 === 0;
        case QRMaskPattern.PATTERN110 : return ( (i * j) % 2 + (i * j) % 3) % 2 === 0;
        case QRMaskPattern.PATTERN111 : return ( (i * j) % 3 + (i + j) % 2) % 2 === 0;

        default :
            throw new Error("bad maskPattern:" + maskPattern);
        }
    },

    getErrorCorrectPolynomial : function(errorCorrectLength) {

        var a = new QRPolynomial([1], 0);

        for (var i = 0; i < errorCorrectLength; i++) {
            a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0) );
        }

        return a;
    },

    getLengthInBits : function(mode, type) {

        if (1 <= type && type < 10) {

            // 1 - 9

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 10;
            case QRMode.MODE_ALPHA_NUM  : return 9;
            case QRMode.MODE_8BIT_BYTE  : return 8;
            case QRMode.MODE_KANJI      : return 8;
            default :
                throw new Error("mode:" + mode);
            }

        } else if (type < 27) {

            // 10 - 26

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 12;
            case QRMode.MODE_ALPHA_NUM  : return 11;
            case QRMode.MODE_8BIT_BYTE  : return 16;
            case QRMode.MODE_KANJI      : return 10;
            default :
                throw new Error("mode:" + mode);
            }

        } else if (type < 41) {

            // 27 - 40

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 14;
            case QRMode.MODE_ALPHA_NUM  : return 13;
            case QRMode.MODE_8BIT_BYTE  : return 16;
            case QRMode.MODE_KANJI      : return 12;
            default :
                throw new Error("mode:" + mode);
            }

        } else {
            throw new Error("type:" + type);
        }
    },

    getLostPoint : function(qrCode) {
        
        var moduleCount = qrCode.getModuleCount();
        var lostPoint = 0;
        var row = 0; 
        var col = 0;

        
        // LEVEL1
        
        for (row = 0; row < moduleCount; row++) {

            for (col = 0; col < moduleCount; col++) {

                var sameCount = 0;
                var dark = qrCode.isDark(row, col);

                for (var r = -1; r <= 1; r++) {

                    if (row + r < 0 || moduleCount <= row + r) {
                        continue;
                    }

                    for (var c = -1; c <= 1; c++) {

                        if (col + c < 0 || moduleCount <= col + c) {
                            continue;
                        }

                        if (r === 0 && c === 0) {
                            continue;
                        }

                        if (dark === qrCode.isDark(row + r, col + c) ) {
                            sameCount++;
                        }
                    }
                }

                if (sameCount > 5) {
                    lostPoint += (3 + sameCount - 5);
                }
            }
        }

        // LEVEL2

        for (row = 0; row < moduleCount - 1; row++) {
            for (col = 0; col < moduleCount - 1; col++) {
                var count = 0;
                if (qrCode.isDark(row,     col    ) ) count++;
                if (qrCode.isDark(row + 1, col    ) ) count++;
                if (qrCode.isDark(row,     col + 1) ) count++;
                if (qrCode.isDark(row + 1, col + 1) ) count++;
                if (count === 0 || count === 4) {
                    lostPoint += 3;
                }
            }
        }

        // LEVEL3

        for (row = 0; row < moduleCount; row++) {
            for (col = 0; col < moduleCount - 6; col++) {
                if (qrCode.isDark(row, col) && 
                        !qrCode.isDark(row, col + 1) && 
                         qrCode.isDark(row, col + 2) && 
                         qrCode.isDark(row, col + 3) && 
                         qrCode.isDark(row, col + 4) && 
                        !qrCode.isDark(row, col + 5) && 
                         qrCode.isDark(row, col + 6) ) {
                    lostPoint += 40;
                }
            }
        }

        for (col = 0; col < moduleCount; col++) {
            for (row = 0; row < moduleCount - 6; row++) {
                if (qrCode.isDark(row, col) &&
                        !qrCode.isDark(row + 1, col) &&
                         qrCode.isDark(row + 2, col) &&
                         qrCode.isDark(row + 3, col) &&
                         qrCode.isDark(row + 4, col) &&
                        !qrCode.isDark(row + 5, col) &&
                         qrCode.isDark(row + 6, col) ) {
                    lostPoint += 40;
                }
            }
        }

        // LEVEL4
        
        var darkCount = 0;

        for (col = 0; col < moduleCount; col++) {
            for (row = 0; row < moduleCount; row++) {
                if (qrCode.isDark(row, col) ) {
                    darkCount++;
                }
            }
        }
        
        var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
        lostPoint += ratio * 10;

        return lostPoint;       
    }

};

module.exports = QRUtil;

return module.exports; })();
__m["QR8bitByte"] = (function () { var module = { exports: {} };
var QRMode = require('./QRMode');

function QR8bitByte(data) {
	this.mode = QRMode.MODE_8BIT_BYTE;
	this.data = data;
}

QR8bitByte.prototype = {

	getLength : function() {
		return this.data.length;
	},
	
	write : function(buffer) {
		for (var i = 0; i < this.data.length; i++) {
			// not JIS ...
			buffer.put(this.data.charCodeAt(i), 8);
		}
	}
};

module.exports = QR8bitByte;

return module.exports; })();
__m["QRRSBlock"] = (function () { var module = { exports: {} };
var QRErrorCorrectLevel = require('./QRErrorCorrectLevel');

function QRRSBlock(totalCount, dataCount) {
	this.totalCount = totalCount;
	this.dataCount  = dataCount;
}

QRRSBlock.RS_BLOCK_TABLE = [

	// L
	// M
	// Q
	// H

	// 1
	[1, 26, 19],
	[1, 26, 16],
	[1, 26, 13],
	[1, 26, 9],
	
	// 2
	[1, 44, 34],
	[1, 44, 28],
	[1, 44, 22],
	[1, 44, 16],

	// 3
	[1, 70, 55],
	[1, 70, 44],
	[2, 35, 17],
	[2, 35, 13],

	// 4		
	[1, 100, 80],
	[2, 50, 32],
	[2, 50, 24],
	[4, 25, 9],
	
	// 5
	[1, 134, 108],
	[2, 67, 43],
	[2, 33, 15, 2, 34, 16],
	[2, 33, 11, 2, 34, 12],
	
	// 6
	[2, 86, 68],
	[4, 43, 27],
	[4, 43, 19],
	[4, 43, 15],
	
	// 7		
	[2, 98, 78],
	[4, 49, 31],
	[2, 32, 14, 4, 33, 15],
	[4, 39, 13, 1, 40, 14],
	
	// 8
	[2, 121, 97],
	[2, 60, 38, 2, 61, 39],
	[4, 40, 18, 2, 41, 19],
	[4, 40, 14, 2, 41, 15],
	
	// 9
	[2, 146, 116],
	[3, 58, 36, 2, 59, 37],
	[4, 36, 16, 4, 37, 17],
	[4, 36, 12, 4, 37, 13],
	
	// 10		
	[2, 86, 68, 2, 87, 69],
	[4, 69, 43, 1, 70, 44],
	[6, 43, 19, 2, 44, 20],
	[6, 43, 15, 2, 44, 16],

	// 11
	[4, 101, 81],
	[1, 80, 50, 4, 81, 51],
	[4, 50, 22, 4, 51, 23],
	[3, 36, 12, 8, 37, 13],

	// 12
	[2, 116, 92, 2, 117, 93],
	[6, 58, 36, 2, 59, 37],
	[4, 46, 20, 6, 47, 21],
	[7, 42, 14, 4, 43, 15],

	// 13
	[4, 133, 107],
	[8, 59, 37, 1, 60, 38],
	[8, 44, 20, 4, 45, 21],
	[12, 33, 11, 4, 34, 12],

	// 14
	[3, 145, 115, 1, 146, 116],
	[4, 64, 40, 5, 65, 41],
	[11, 36, 16, 5, 37, 17],
	[11, 36, 12, 5, 37, 13],

	// 15
	[5, 109, 87, 1, 110, 88],
	[5, 65, 41, 5, 66, 42],
	[5, 54, 24, 7, 55, 25],
	[11, 36, 12],

	// 16
	[5, 122, 98, 1, 123, 99],
	[7, 73, 45, 3, 74, 46],
	[15, 43, 19, 2, 44, 20],
	[3, 45, 15, 13, 46, 16],

	// 17
	[1, 135, 107, 5, 136, 108],
	[10, 74, 46, 1, 75, 47],
	[1, 50, 22, 15, 51, 23],
	[2, 42, 14, 17, 43, 15],

	// 18
	[5, 150, 120, 1, 151, 121],
	[9, 69, 43, 4, 70, 44],
	[17, 50, 22, 1, 51, 23],
	[2, 42, 14, 19, 43, 15],

	// 19
	[3, 141, 113, 4, 142, 114],
	[3, 70, 44, 11, 71, 45],
	[17, 47, 21, 4, 48, 22],
	[9, 39, 13, 16, 40, 14],

	// 20
	[3, 135, 107, 5, 136, 108],
	[3, 67, 41, 13, 68, 42],
	[15, 54, 24, 5, 55, 25],
	[15, 43, 15, 10, 44, 16],

	// 21
	[4, 144, 116, 4, 145, 117],
	[17, 68, 42],
	[17, 50, 22, 6, 51, 23],
	[19, 46, 16, 6, 47, 17],

	// 22
	[2, 139, 111, 7, 140, 112],
	[17, 74, 46],
	[7, 54, 24, 16, 55, 25],
	[34, 37, 13],

	// 23
	[4, 151, 121, 5, 152, 122],
	[4, 75, 47, 14, 76, 48],
	[11, 54, 24, 14, 55, 25],
	[16, 45, 15, 14, 46, 16],

	// 24
	[6, 147, 117, 4, 148, 118],
	[6, 73, 45, 14, 74, 46],
	[11, 54, 24, 16, 55, 25],
	[30, 46, 16, 2, 47, 17],

	// 25
	[8, 132, 106, 4, 133, 107],
	[8, 75, 47, 13, 76, 48],
	[7, 54, 24, 22, 55, 25],
	[22, 45, 15, 13, 46, 16],

	// 26
	[10, 142, 114, 2, 143, 115],
	[19, 74, 46, 4, 75, 47],
	[28, 50, 22, 6, 51, 23],
	[33, 46, 16, 4, 47, 17],

	// 27
	[8, 152, 122, 4, 153, 123],
	[22, 73, 45, 3, 74, 46],
	[8, 53, 23, 26, 54, 24],
	[12, 45, 15, 28, 46, 16],

	// 28
	[3, 147, 117, 10, 148, 118],
	[3, 73, 45, 23, 74, 46],
	[4, 54, 24, 31, 55, 25],
	[11, 45, 15, 31, 46, 16],

	// 29
	[7, 146, 116, 7, 147, 117],
	[21, 73, 45, 7, 74, 46],
	[1, 53, 23, 37, 54, 24],
	[19, 45, 15, 26, 46, 16],

	// 30
	[5, 145, 115, 10, 146, 116],
	[19, 75, 47, 10, 76, 48],
	[15, 54, 24, 25, 55, 25],
	[23, 45, 15, 25, 46, 16],

	// 31
	[13, 145, 115, 3, 146, 116],
	[2, 74, 46, 29, 75, 47],
	[42, 54, 24, 1, 55, 25],
	[23, 45, 15, 28, 46, 16],

	// 32
	[17, 145, 115],
	[10, 74, 46, 23, 75, 47],
	[10, 54, 24, 35, 55, 25],
	[19, 45, 15, 35, 46, 16],

	// 33
	[17, 145, 115, 1, 146, 116],
	[14, 74, 46, 21, 75, 47],
	[29, 54, 24, 19, 55, 25],
	[11, 45, 15, 46, 46, 16],

	// 34
	[13, 145, 115, 6, 146, 116],
	[14, 74, 46, 23, 75, 47],
	[44, 54, 24, 7, 55, 25],
	[59, 46, 16, 1, 47, 17],

	// 35
	[12, 151, 121, 7, 152, 122],
	[12, 75, 47, 26, 76, 48],
	[39, 54, 24, 14, 55, 25],
	[22, 45, 15, 41, 46, 16],

	// 36
	[6, 151, 121, 14, 152, 122],
	[6, 75, 47, 34, 76, 48],
	[46, 54, 24, 10, 55, 25],
	[2, 45, 15, 64, 46, 16],

	// 37
	[17, 152, 122, 4, 153, 123],
	[29, 74, 46, 14, 75, 47],
	[49, 54, 24, 10, 55, 25],
	[24, 45, 15, 46, 46, 16],

	// 38
	[4, 152, 122, 18, 153, 123],
	[13, 74, 46, 32, 75, 47],
	[48, 54, 24, 14, 55, 25],
	[42, 45, 15, 32, 46, 16],

	// 39
	[20, 147, 117, 4, 148, 118],
	[40, 75, 47, 7, 76, 48],
	[43, 54, 24, 22, 55, 25],
	[10, 45, 15, 67, 46, 16],

	// 40
	[19, 148, 118, 6, 149, 119],
	[18, 75, 47, 31, 76, 48],
	[34, 54, 24, 34, 55, 25],
	[20, 45, 15, 61, 46, 16]
];

QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
	
	var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
	
	if (rsBlock === undefined) {
		throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
	}

	var length = rsBlock.length / 3;
	
	var list = [];
	
	for (var i = 0; i < length; i++) {

		var count = rsBlock[i * 3 + 0];
		var totalCount = rsBlock[i * 3 + 1];
		var dataCount  = rsBlock[i * 3 + 2];

		for (var j = 0; j < count; j++) {
			list.push(new QRRSBlock(totalCount, dataCount) );	
		}
	}
	
	return list;
};

QRRSBlock.getRsBlockTable = function(typeNumber, errorCorrectLevel) {

	switch(errorCorrectLevel) {
	case QRErrorCorrectLevel.L :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
	case QRErrorCorrectLevel.M :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
	case QRErrorCorrectLevel.Q :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
	case QRErrorCorrectLevel.H :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
	default :
		return undefined;
	}
};

module.exports = QRRSBlock;

return module.exports; })();
__m["QRBitBuffer"] = (function () { var module = { exports: {} };
function QRBitBuffer() {
	this.buffer = [];
	this.length = 0;
}

QRBitBuffer.prototype = {

	get : function(index) {
		var bufIndex = Math.floor(index / 8);
		return ( (this.buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
	},
	
	put : function(num, length) {
		for (var i = 0; i < length; i++) {
			this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
		}
	},
	
	getLengthInBits : function() {
		return this.length;
	},
	
	putBit : function(bit) {
	
		var bufIndex = Math.floor(this.length / 8);
		if (this.buffer.length <= bufIndex) {
			this.buffer.push(0);
		}
	
		if (bit) {
			this.buffer[bufIndex] |= (0x80 >>> (this.length % 8) );
		}
	
		this.length++;
	}
};

module.exports = QRBitBuffer;

return module.exports; })();
__m["index"] = (function () { var module = { exports: {} };
//---------------------------------------------------------------------
// QRCode for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//   http://www.opensource.org/licenses/mit-license.php
//
// The word "QR Code" is registered trademark of 
// DENSO WAVE INCORPORATED
//   http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------
// Modified to work in node for this project (and some refactoring)
//---------------------------------------------------------------------

var QR8bitByte = require('./QR8bitByte');
var QRUtil = require('./QRUtil');
var QRPolynomial = require('./QRPolynomial');
var QRRSBlock = require('./QRRSBlock');
var QRBitBuffer = require('./QRBitBuffer');

function QRCode(typeNumber, errorCorrectLevel) {
	this.typeNumber = typeNumber;
	this.errorCorrectLevel = errorCorrectLevel;
	this.modules = null;
	this.moduleCount = 0;
	this.dataCache = null;
	this.dataList = [];
}

QRCode.prototype = {
	
	addData : function(data) {
		var newData = new QR8bitByte(data);
		this.dataList.push(newData);
		this.dataCache = null;
	},
	
	isDark : function(row, col) {
		if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
			throw new Error(row + "," + col);
		}
		return this.modules[row][col];
	},

	getModuleCount : function() {
		return this.moduleCount;
	},
	
	make : function() {
		// Calculate automatically typeNumber if provided is < 1
		if (this.typeNumber < 1 ){
			var typeNumber = 1;
			for (typeNumber = 1; typeNumber < 40; typeNumber++) {
				var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel);

				var buffer = new QRBitBuffer();
				var totalDataCount = 0;
				for (var i = 0; i < rsBlocks.length; i++) {
					totalDataCount += rsBlocks[i].dataCount;
				}

				for (var x = 0; x < this.dataList.length; x++) {
					var data = this.dataList[x];
					buffer.put(data.mode, 4);
					buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber) );
					data.write(buffer);
				}
				if (buffer.getLengthInBits() <= totalDataCount * 8)
					break;
			}
			this.typeNumber = typeNumber;
		}
		this.makeImpl(false, this.getBestMaskPattern() );
	},
	
	makeImpl : function(test, maskPattern) {
		
		this.moduleCount = this.typeNumber * 4 + 17;
		this.modules = new Array(this.moduleCount);
		
		for (var row = 0; row < this.moduleCount; row++) {
			
			this.modules[row] = new Array(this.moduleCount);
			
			for (var col = 0; col < this.moduleCount; col++) {
				this.modules[row][col] = null;//(col + row) % 3;
			}
		}
	
		this.setupPositionProbePattern(0, 0);
		this.setupPositionProbePattern(this.moduleCount - 7, 0);
		this.setupPositionProbePattern(0, this.moduleCount - 7);
		this.setupPositionAdjustPattern();
		this.setupTimingPattern();
		this.setupTypeInfo(test, maskPattern);
		
		if (this.typeNumber >= 7) {
			this.setupTypeNumber(test);
		}
	
		if (this.dataCache === null) {
			this.dataCache = QRCode.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
		}
	
		this.mapData(this.dataCache, maskPattern);
	},

	setupPositionProbePattern : function(row, col)  {
		
		for (var r = -1; r <= 7; r++) {
			
			if (row + r <= -1 || this.moduleCount <= row + r) continue;
			
			for (var c = -1; c <= 7; c++) {
				
				if (col + c <= -1 || this.moduleCount <= col + c) continue;
				
				if ( (0 <= r && r <= 6 && (c === 0 || c === 6) ) || 
                     (0 <= c && c <= 6 && (r === 0 || r === 6) ) || 
                     (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
					this.modules[row + r][col + c] = true;
				} else {
					this.modules[row + r][col + c] = false;
				}
			}		
		}		
	},
	
	getBestMaskPattern : function() {
	
		var minLostPoint = 0;
		var pattern = 0;
	
		for (var i = 0; i < 8; i++) {
			
			this.makeImpl(true, i);
	
			var lostPoint = QRUtil.getLostPoint(this);
	
			if (i === 0 || minLostPoint >  lostPoint) {
				minLostPoint = lostPoint;
				pattern = i;
			}
		}
	
		return pattern;
	},
	
	createMovieClip : function(target_mc, instance_name, depth) {
	
		var qr_mc = target_mc.createEmptyMovieClip(instance_name, depth);
		var cs = 1;
	
		this.make();

		for (var row = 0; row < this.modules.length; row++) {
			
			var y = row * cs;
			
			for (var col = 0; col < this.modules[row].length; col++) {
	
				var x = col * cs;
				var dark = this.modules[row][col];
			
				if (dark) {
					qr_mc.beginFill(0, 100);
					qr_mc.moveTo(x, y);
					qr_mc.lineTo(x + cs, y);
					qr_mc.lineTo(x + cs, y + cs);
					qr_mc.lineTo(x, y + cs);
					qr_mc.endFill();
				}
			}
		}
		
		return qr_mc;
	},

	setupTimingPattern : function() {
		
		for (var r = 8; r < this.moduleCount - 8; r++) {
			if (this.modules[r][6] !== null) {
				continue;
			}
			this.modules[r][6] = (r % 2 === 0);
		}
	
		for (var c = 8; c < this.moduleCount - 8; c++) {
			if (this.modules[6][c] !== null) {
				continue;
			}
			this.modules[6][c] = (c % 2 === 0);
		}
	},
	
	setupPositionAdjustPattern : function() {
	
		var pos = QRUtil.getPatternPosition(this.typeNumber);
		
		for (var i = 0; i < pos.length; i++) {
		
			for (var j = 0; j < pos.length; j++) {
			
				var row = pos[i];
				var col = pos[j];
				
				if (this.modules[row][col] !== null) {
					continue;
				}
				
				for (var r = -2; r <= 2; r++) {
				
					for (var c = -2; c <= 2; c++) {
					
						if (Math.abs(r) === 2 || 
                            Math.abs(c) === 2 ||
                            (r === 0 && c === 0) ) {
							this.modules[row + r][col + c] = true;
						} else {
							this.modules[row + r][col + c] = false;
						}
					}
				}
			}
		}
	},
	
	setupTypeNumber : function(test) {
	
		var bits = QRUtil.getBCHTypeNumber(this.typeNumber);
        var mod;
	
		for (var i = 0; i < 18; i++) {
			mod = (!test && ( (bits >> i) & 1) === 1);
			this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
		}
	
		for (var x = 0; x < 18; x++) {
			mod = (!test && ( (bits >> x) & 1) === 1);
			this.modules[x % 3 + this.moduleCount - 8 - 3][Math.floor(x / 3)] = mod;
		}
	},
	
	setupTypeInfo : function(test, maskPattern) {
	
		var data = (this.errorCorrectLevel << 3) | maskPattern;
		var bits = QRUtil.getBCHTypeInfo(data);
        var mod;
	
		// vertical		
		for (var v = 0; v < 15; v++) {
	
			mod = (!test && ( (bits >> v) & 1) === 1);
	
			if (v < 6) {
				this.modules[v][8] = mod;
			} else if (v < 8) {
				this.modules[v + 1][8] = mod;
			} else {
				this.modules[this.moduleCount - 15 + v][8] = mod;
			}
		}
	
		// horizontal
		for (var h = 0; h < 15; h++) {
	
			mod = (!test && ( (bits >> h) & 1) === 1);
			
			if (h < 8) {
				this.modules[8][this.moduleCount - h - 1] = mod;
			} else if (h < 9) {
				this.modules[8][15 - h - 1 + 1] = mod;
			} else {
				this.modules[8][15 - h - 1] = mod;
			}
		}
	
		// fixed module
		this.modules[this.moduleCount - 8][8] = (!test);
	
	},
	
	mapData : function(data, maskPattern) {
		
		var inc = -1;
		var row = this.moduleCount - 1;
		var bitIndex = 7;
		var byteIndex = 0;
		
		for (var col = this.moduleCount - 1; col > 0; col -= 2) {
	
			if (col === 6) col--;
	
			while (true) {
	
				for (var c = 0; c < 2; c++) {
					
					if (this.modules[row][col - c] === null) {
						
						var dark = false;
	
						if (byteIndex < data.length) {
							dark = ( ( (data[byteIndex] >>> bitIndex) & 1) === 1);
						}
	
						var mask = QRUtil.getMask(maskPattern, row, col - c);
	
						if (mask) {
							dark = !dark;
						}
						
						this.modules[row][col - c] = dark;
						bitIndex--;
	
						if (bitIndex === -1) {
							byteIndex++;
							bitIndex = 7;
						}
					}
				}
								
				row += inc;
	
				if (row < 0 || this.moduleCount <= row) {
					row -= inc;
					inc = -inc;
					break;
				}
			}
		}
		
	}

};

QRCode.PAD0 = 0xEC;
QRCode.PAD1 = 0x11;

QRCode.createData = function(typeNumber, errorCorrectLevel, dataList) {
	
	var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
	
	var buffer = new QRBitBuffer();
	
	for (var i = 0; i < dataList.length; i++) {
		var data = dataList[i];
		buffer.put(data.mode, 4);
		buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber) );
		data.write(buffer);
	}

	// calc num max data.
	var totalDataCount = 0;
	for (var x = 0; x < rsBlocks.length; x++) {
		totalDataCount += rsBlocks[x].dataCount;
	}

	if (buffer.getLengthInBits() > totalDataCount * 8) {
		throw new Error("code length overflow. (" + 
            buffer.getLengthInBits() + 
            ">" +  
            totalDataCount * 8 + 
            ")");
	}

	// end code
	if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
		buffer.put(0, 4);
	}

	// padding
	while (buffer.getLengthInBits() % 8 !== 0) {
		buffer.putBit(false);
	}

	// padding
	while (true) {
		
		if (buffer.getLengthInBits() >= totalDataCount * 8) {
			break;
		}
		buffer.put(QRCode.PAD0, 8);
		
		if (buffer.getLengthInBits() >= totalDataCount * 8) {
			break;
		}
		buffer.put(QRCode.PAD1, 8);
	}

	return QRCode.createBytes(buffer, rsBlocks);
};

QRCode.createBytes = function(buffer, rsBlocks) {

	var offset = 0;
	
	var maxDcCount = 0;
	var maxEcCount = 0;
	
	var dcdata = new Array(rsBlocks.length);
	var ecdata = new Array(rsBlocks.length);
	
	for (var r = 0; r < rsBlocks.length; r++) {

		var dcCount = rsBlocks[r].dataCount;
		var ecCount = rsBlocks[r].totalCount - dcCount;

		maxDcCount = Math.max(maxDcCount, dcCount);
		maxEcCount = Math.max(maxEcCount, ecCount);
		
		dcdata[r] = new Array(dcCount);
		
		for (var i = 0; i < dcdata[r].length; i++) {
			dcdata[r][i] = 0xff & buffer.buffer[i + offset];
		}
		offset += dcCount;
		
		var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
		var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);

		var modPoly = rawPoly.mod(rsPoly);
		ecdata[r] = new Array(rsPoly.getLength() - 1);
		for (var x = 0; x < ecdata[r].length; x++) {
            var modIndex = x + modPoly.getLength() - ecdata[r].length;
			ecdata[r][x] = (modIndex >= 0)? modPoly.get(modIndex) : 0;
		}

	}
	
	var totalCodeCount = 0;
	for (var y = 0; y < rsBlocks.length; y++) {
		totalCodeCount += rsBlocks[y].totalCount;
	}

	var data = new Array(totalCodeCount);
	var index = 0;

	for (var z = 0; z < maxDcCount; z++) {
		for (var s = 0; s < rsBlocks.length; s++) {
			if (z < dcdata[s].length) {
				data[index++] = dcdata[s][z];
			}
		}
	}

	for (var xx = 0; xx < maxEcCount; xx++) {
		for (var t = 0; t < rsBlocks.length; t++) {
			if (xx < ecdata[t].length) {
				data[index++] = ecdata[t][xx];
			}
		}
	}

	return data;

};

module.exports = QRCode;

return module.exports; })();

var QRCode = __m["index"], EC = __m["QRErrorCorrectLevel"];
function qrMatrix(text, level) {
  var q = new QRCode(-1, EC[level || "M"]);
  q.addData(String(text)); q.make();
  var n = q.getModuleCount(), m = [];
  for (var r = 0; r < n; r++) { var row = []; for (var c = 0; c < n; c++) row.push(q.isDark(r, c)); m.push(row); }
  return m;
}
window.qrMatrix = qrMatrix;
window.makeQR = function (text, opts) {
  opts = opts || {};
  var m = qrMatrix(text, opts.level), n = m.length, b = 4, size = n + b * 2, d = "";
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += "M" + (c + b) + " " + (r + b) + "h1v1h-1z";
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
    '<rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
};

/* ---------------- QR decoder (camera images) — written for SORT Inventory ----------------
 * Pipeline: grayscale → local-threshold binarize → find 3 finder patterns → estimate version →
 * find alignment pattern → perspective sample → format info → unmask → de-interleave →
 * Reed–Solomon correct → parse segments. Reuses the encoder's own layout tables above.
 * window.decodeQR({data, width, height}) → string | null
 */
var QRUtilD = __m["QRUtil"], QRRSBlockD = __m["QRRSBlock"];

function binarize(img) {
  var w = img.width, h = img.height, d = img.data, n = w * h;
  var lum = new Uint8Array(n);
  for (var i = 0, p = 0; i < n; i++, p += 4) lum[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
  var R = 8, bw = Math.ceil(w / R), bh = Math.ceil(h / R);
  var avg = new Float32Array(bw * bh);
  for (var by = 0; by < bh; by++) for (var bx = 0; bx < bw; bx++) {
    var sum = 0, mn = 255, mx = 0, cnt = 0;
    for (var y = by * R; y < Math.min(h, by * R + R); y++) for (var x = bx * R; x < Math.min(w, bx * R + R); x++) {
      var v = lum[y * w + x]; sum += v; cnt++; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    var a = sum / cnt;
    if (mx - mn <= 24) {
      a = mn / 2;
      if (by > 0 && bx > 0) {
        var nb = (avg[(by - 1) * bw + bx] + 2 * avg[by * bw + bx - 1] + avg[(by - 1) * bw + bx - 1]) / 4;
        if (mn < nb) a = nb;
      }
    }
    avg[by * bw + bx] = a;
  }
  var bits = new Uint8Array(n);
  for (by = 0; by < bh; by++) for (bx = 0; bx < bw; bx++) {
    var l = Math.min(Math.max(bx, 2), Math.max(bw - 3, 2)), t = Math.min(Math.max(by, 2), Math.max(bh - 3, 2));
    var s = 0, c = 0;
    for (var yy = t - 2; yy <= t + 2; yy++) for (var xx = l - 2; xx <= l + 2; xx++) {
      if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { s += avg[yy * bw + xx]; c++; }
    }
    var th = s / c;
    for (y = by * R; y < Math.min(h, by * R + R); y++) for (x = bx * R; x < Math.min(w, bx * R + R); x++) {
      bits[y * w + x] = lum[y * w + x] <= th ? 1 : 0;
    }
  }
  return { w: w, h: h, b: bits, get: function (x, y) { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < w && y < h ? bits[y * w + x] : 0; } };
}

/* ---------- finder patterns ---------- */
function ratioOk(c) {
  var total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (total < 7) return false;
  var m = total / 7, v = m * 0.7;
  return Math.abs(m - c[0]) < v && Math.abs(m - c[1]) < v && Math.abs(3 * m - c[2]) < 3 * v &&
         Math.abs(m - c[3]) < v && Math.abs(m - c[4]) < v;
}
function centerFromEnd(c, end) { return end - c[4] - c[3] - c[2] / 2; }

function findFinders(B) {
  var found = [];
  var skip = Math.max(1, Math.floor(B.h / 240));
  for (var y = 0; y < B.h; y += skip) {
    var c = [0, 0, 0, 0, 0], st = 0, base = y * B.w;
    for (var x = 0; x < B.w; x++) {
      if (B.b[base + x]) {                    // dark
        if (st === 1 || st === 3) st++;
        c[st]++;
      } else {                                // light
        if (st === 0) { if (c[0]) { st = 1; c[1] = 1; } }
        else if (st === 2) { st = 3; c[3] = 1; }
        else if (st === 4) {
          if (ratioOk(c)) handleCenter(B, found, c, y, x);
          c = [c[2], c[3], c[4], 1, 0]; st = 3;
        } else c[st]++;
      }
    }
    if (st === 4 && ratioOk(c)) handleCenter(B, found, c, y, B.w);
  }
  return found;
}

function runLen(B, x, y, dx, dy, dark, limit) {
  var n = 0;
  while (n < limit) {
    var px = Math.round(x + dx * n), py = Math.round(y + dy * n);
    if (px < 0 || py < 0 || px >= B.w || py >= B.h) return -1;
    if (!!B.b[py * B.w + px] !== dark) break;
    n++;
  }
  return n;
}

/** Measures 1:1:3:1:1 along a direction through (x,y). Returns {center offset, total} or null. */
function measure(B, x, y, dx, dy, maxTotal) {
  if (!B.get(x, y)) return null;
  var lim = maxTotal;
  var a = runLen(B, x, y, -dx, -dy, true, lim); if (a < 0) return null;
  var b = runLen(B, x - dx * a, y - dy * a, -dx, -dy, false, lim); if (b <= 0) return null;
  var c = runLen(B, x - dx * (a + b), y - dy * (a + b), -dx, -dy, true, lim); if (c <= 0) return null;
  var d = runLen(B, x, y, dx, dy, true, lim); if (d < 0) return null;
  var e = runLen(B, x + dx * d, y + dy * d, dx, dy, false, lim); if (e <= 0) return null;
  var f = runLen(B, x + dx * (d + e), y + dy * (d + e), dx, dy, true, lim); if (f <= 0) return null;
  var counts = [c, b, a + d - 1, e, f];
  if (!ratioOk(counts)) return null;
  var total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  // center of the middle run relative to (x,y)
  var off = ((d - 1) - (a - 1)) / 2;
  return { off: off, total: total };
}

function handleCenter(B, found, c, y, xEnd) {
  var total = c[0] + c[1] + c[2] + c[3] + c[4];
  var cx = centerFromEnd(c, xEnd);
  var mv = measure(B, cx, y, 0, 1, total * 1.6);
  if (!mv) return;
  var cy = y + mv.off;
  var mh = measure(B, cx, cy, 1, 0, total * 1.6);
  if (!mh) return;
  cx = cx + mh.off;
  var md = measure(B, cx, cy, 0.7071, 0.7071, total * 1.6);   // diagonal sanity check
  if (!md) return;
  var size = (mv.total + mh.total) / 14;
  for (var i = 0; i < found.length; i++) {
    var f = found[i];
    if (Math.abs(f.x - cx) <= size * 1.5 && Math.abs(f.y - cy) <= size * 1.5 && Math.abs(f.size - size) <= Math.max(1, size * 0.5)) {
      var n = f.count;
      f.x = (f.x * n + cx) / (n + 1); f.y = (f.y * n + cy) / (n + 1); f.size = (f.size * n + size) / (n + 1); f.count++;
      return;
    }
  }
  found.push({ x: cx, y: cy, size: size, count: 1 });
}

function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

function pickTriples(found) {
  var cands = found.filter(function (f) { return f.count >= 2; });
  if (cands.length < 3) cands = found.slice();
  cands.sort(function (a, b) { return b.count - a.count; });
  cands = cands.slice(0, 12);
  var out = [];
  for (var i = 0; i < cands.length; i++) for (var j = i + 1; j < cands.length; j++) for (var k = j + 1; k < cands.length; k++) {
    var p = [cands[i], cands[j], cands[k]];
    var ms = (p[0].size + p[1].size + p[2].size) / 3;
    if (Math.max(p[0].size, p[1].size, p[2].size) > 1.8 * Math.min(p[0].size, p[1].size, p[2].size)) continue;
    var d01 = dist(p[0], p[1]), d12 = dist(p[1], p[2]), d02 = dist(p[0], p[2]);
    // B = vertex opposite the longest side (top-left)
    var tl, a, c, hyp, s1, s2;
    if (d12 >= d01 && d12 >= d02) { tl = p[0]; a = p[1]; c = p[2]; hyp = d12; s1 = d01; s2 = d02; }
    else if (d02 >= d01 && d02 >= d12) { tl = p[1]; a = p[0]; c = p[2]; hyp = d02; s1 = d01; s2 = d12; }
    else { tl = p[2]; a = p[0]; c = p[1]; hyp = d01; s1 = d02; s2 = d12; }
    if (s1 < ms * 8 || s2 < ms * 8) continue;            // ~version-1 spacing, allowing 45° rotation
    var score = Math.abs(s1 - s2) / Math.max(s1, s2) + Math.abs(hyp - Math.SQRT2 * (s1 + s2) / 2) / hyp;
    if (score > 0.5) continue;
    // orientation: cross product decides which of a/c is top-right
    var cross = (a.x - tl.x) * (c.y - tl.y) - (a.y - tl.y) * (c.x - tl.x);
    var tr = cross > 0 ? a : c, bl = cross > 0 ? c : a;
    out.push({ tl: tl, tr: tr, bl: bl, score: score, ms: ms });
  }
  out.sort(function (x, y) { return x.score - y.score; });
  return out.slice(0, 4);
}

/* ---------- perspective transform (square → quad) ---------- */
function adjugate(m) {
  return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
          m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
          m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
}
function mul3(a, b) {
  var r = [];
  for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  return r;
}
function quadToQuad(src, dst) {
  // returns f(u,v) -> {x,y}
  var sq2dst = squareToQuadM(dst), sq2src = squareToQuadM(src);
  var src2sq = adjugate(sq2src);
  var M = mul3(sq2dst, src2sq);
  return function (u, v) {
    var w = M[6] * u + M[7] * v + M[8];
    return { x: (M[0] * u + M[1] * v + M[2]) / w, y: (M[3] * u + M[4] * v + M[5]) / w };
  };
}
function squareToQuadM(q) {
  // q: [x0,y0, x1,y1, x2,y2, x3,y3] for unit square corners (0,0),(1,0),(1,1),(0,1)
  var x0 = q[0], y0 = q[1], x1 = q[2], y1 = q[3], x2 = q[4], y2 = q[5], x3 = q[6], y3 = q[7];
  var dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3, g, hh;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { g = 0; hh = 0; }
  else {
    var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den; hh = (dx1 * dy3 - dx3 * dy1) / den;
  }
  // x = (a u + b v + c)/(g u + h v + 1)
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0,
          y1 - y0 + g * y1, y3 - y0 + hh * y3, y0,
          g, hh, 1];
}

/* ---------- alignment pattern ---------- */
function findAlignment(B, tl, tr, bl, dim, ms) {
  var brx = tr.x - tl.x + bl.x, bry = tr.y - tl.y + bl.y;
  var corr = 1 - 3 / (dim - 7);
  var ex = tl.x + corr * (brx - tl.x), ey = tl.y + corr * (bry - tl.y);
  var ux = (tr.x - tl.x) / (dim - 7), uy = (tr.y - tl.y) / (dim - 7);
  var vx = (bl.x - tl.x) / (dim - 7), vy = (bl.y - tl.y) / (dim - 7);
  var tmpl = [];
  for (var j = -2; j <= 2; j++) for (var i = -2; i <= 2; i++) {
    var ring = Math.max(Math.abs(i), Math.abs(j));
    tmpl.push([i, j, ring !== 1 ? 1 : 0]);
  }
  var best = null, bestScore = -1;
  var rad = Math.ceil(ms * 5);
  for (var dy = -rad; dy <= rad; dy++) for (var dx = -rad; dx <= rad; dx++) {
    var cx = ex + dx, cy = ey + dy, sc = 0;
    for (var t = 0; t < 25; t++) {
      var px = cx + ux * tmpl[t][0] + vx * tmpl[t][1], py = cy + uy * tmpl[t][0] + vy * tmpl[t][1];
      if (B.get(px, py) === tmpl[t][2]) sc++;
    }
    var dpen = (dx * dx + dy * dy) / (rad * rad);   // prefer closer to estimate on ties
    if (sc - dpen > bestScore) { bestScore = sc - dpen; best = { x: cx, y: cy, sc: sc }; }
  }
  if (!best || best.sc < 23) return null;
  // refine: centroid of all positions with the max score
  var sx = 0, sy = 0, n = 0;
  for (dy = -3; dy <= 3; dy++) for (dx = -3; dx <= 3; dx++) {
    var qx = best.x + dx, qy = best.y + dy, s2 = 0;
    for (t = 0; t < 25; t++) {
      if (B.get(qx + ux * tmpl[t][0] + vx * tmpl[t][1], qy + uy * tmpl[t][0] + vy * tmpl[t][1]) === tmpl[t][2]) s2++;
    }
    if (s2 >= best.sc) { sx += qx; sy += qy; n++; }
  }
  return { x: sx / n, y: sy / n };
}

/* ---------- sampling & decoding ---------- */
function sampleGrid(B, tf, dim) {
  var m = [];
  for (var r = 0; r < dim; r++) {
    var row = [];
    for (var c = 0; c < dim; c++) {
      var p = tf(c + 0.5, r + 0.5);
      row.push(B.get(p.x, p.y) === 1);
    }
    m.push(row);
  }
  return m;
}

function popcount(x) { var n = 0; while (x) { n += x & 1; x >>>= 1; } return n; }

function readFormat(m, dim) {
  var a = 0, b = 0;
  for (var v = 0; v < 15; v++) {
    var row = v < 6 ? v : v < 8 ? v + 1 : dim - 15 + v;
    if (m[row][8]) a |= 1 << v;
    var col = v < 8 ? dim - v - 1 : v < 9 ? 7 : 15 - v - 1;
    if (m[8][col]) b |= 1 << v;
  }
  var best = null, bd = 99;
  for (var data = 0; data < 32; data++) {
    var code = QRUtilD.getBCHTypeInfo(data);
    var d = Math.min(popcount(code ^ a), popcount(code ^ b));
    if (d < bd) { bd = d; best = data; }
  }
  return bd <= 3 ? { ecl: best >> 3, mask: best & 7 } : null;
}

function functionMap(version, ecl, dim) {
  var q = Object.create(__m["index"].prototype);
  q.typeNumber = version; q.errorCorrectLevel = ecl; q.moduleCount = dim;
  q.modules = [];
  for (var r = 0; r < dim; r++) { q.modules.push(new Array(dim)); for (var c = 0; c < dim; c++) q.modules[r][c] = null; }
  q.setupPositionProbePattern(0, 0); q.setupPositionProbePattern(dim - 7, 0); q.setupPositionProbePattern(0, dim - 7);
  q.setupPositionAdjustPattern(); q.setupTimingPattern(); q.setupTypeInfo(true, 0);
  if (version >= 7) q.setupTypeNumber(true);
  return q.modules;
}

function readCodewords(m, fmap, dim, mask) {
  var bytes = [], cur = 0, nb = 0, inc = -1, row = dim - 1;
  for (var col = dim - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (var c = 0; c < 2; c++) {
        if (fmap[row][col - c] === null) {
          var bit = m[row][col - c];
          if (QRUtilD.getMask(mask, row, col - c)) bit = !bit;
          cur = (cur << 1) | (bit ? 1 : 0); nb++;
          if (nb === 8) { bytes.push(cur); cur = 0; nb = 0; }
        }
      }
      row += inc;
      if (row < 0 || dim <= row) { row -= inc; inc = -inc; break; }
    }
  }
  return bytes;
}

/* Reed–Solomon over GF(256), primitive 0x11d, generator roots α^0..α^(n-1) */
var GEXP = new Array(512), GLOG = new Array(256);
(function () { var x = 1; for (var i = 0; i < 255; i++) { GEXP[i] = x; GLOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (i = 255; i < 512; i++) GEXP[i] = GEXP[i - 255]; })();
function gmul(a, b) { return a && b ? GEXP[GLOG[a] + GLOG[b]] : 0; }
function gdiv(a, b) { return a ? GEXP[(GLOG[a] + 255 - GLOG[b]) % 255] : 0; }
function gpow(x, p) { return GEXP[(((GLOG[x] * p) % 255) + 255) % 255]; }
function ginv(x) { return GEXP[255 - GLOG[x]]; }
function pscale(p, x) { return p.map(function (c) { return gmul(c, x); }); }
function padd(p, q) {
  var n = Math.max(p.length, q.length), r = new Array(n).fill(0);
  for (var i = 0; i < p.length; i++) r[i + n - p.length] = p[i];
  for (i = 0; i < q.length; i++) r[i + n - q.length] ^= q[i];
  return r;
}
function pmul(p, q) {
  var r = new Array(p.length + q.length - 1).fill(0);
  for (var j = 0; j < q.length; j++) for (var i = 0; i < p.length; i++) r[i + j] ^= gmul(p[i], q[j]);
  return r;
}
function peval(p, x) { var y = p[0]; for (var i = 1; i < p.length; i++) y = gmul(y, x) ^ p[i]; return y; }
function pdivRem(dd, dv) {
  var out = dd.slice();
  for (var i = 0; i < dd.length - (dv.length - 1); i++) {
    var coef = out[i];
    if (coef) for (var j = 1; j < dv.length; j++) if (dv[j]) out[i + j] ^= gmul(dv[j], coef);
  }
  return out.slice(out.length - (dv.length - 1));
}
function rsCorrect(msg, nsym) {
  var synd = [0];
  var any = false;
  for (var i = 0; i < nsym; i++) { var s = peval(msg, gpow(2, i)); synd.push(s); if (s) any = true; }
  if (!any) return msg;
  // Berlekamp–Massey
  var errLoc = [1], oldLoc = [1];
  for (i = 0; i < nsym; i++) {
    var K = i + 1, delta = synd[K];
    for (var j = 1; j < errLoc.length; j++) delta ^= gmul(errLoc[errLoc.length - 1 - j], synd[K - j]);
    oldLoc = oldLoc.concat([0]);
    if (delta) {
      if (oldLoc.length > errLoc.length) { var nl = pscale(oldLoc, delta); oldLoc = pscale(errLoc, ginv(delta)); errLoc = nl; }
      errLoc = padd(errLoc, pscale(oldLoc, delta));
    }
  }
  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  var errs = errLoc.length - 1;
  if (errs * 2 > nsym) return null;
  // Chien search
  var rev = errLoc.slice().reverse(), pos = [];
  for (i = 0; i < msg.length; i++) if (peval(rev, gpow(2, i)) === 0) pos.push(msg.length - 1 - i);
  if (pos.length !== errs) return null;
  // Forney
  var coefPos = pos.map(function (p) { return msg.length - 1 - p; });
  var eLoc = [1];
  coefPos.forEach(function (cp) { eLoc = pmul(eLoc, padd([1], [gpow(2, cp), 0])); });
  var sr = synd.slice().reverse();
  var evalPoly = pdivRem(pmul(sr, eLoc), [1].concat(new Array(eLoc.length).fill(0)));
  evalPoly = evalPoly.slice(evalPoly.length - eLoc.length);   // remainder of degree < len(eLoc)
  evalPoly = evalPoly.reverse();
  var X = coefPos.map(function (cp) { return gpow(2, -(255 - cp)); });
  var out = msg.slice();
  for (i = 0; i < X.length; i++) {
    var Xi = X[i], Xinv = ginv(Xi), prime = 1;
    for (j = 0; j < X.length; j++) if (j !== i) prime = gmul(prime, 1 ^ gmul(Xinv, X[j]));
    var y = gmul(Xi, peval(evalPoly.slice().reverse(), Xinv));
    if (!prime) return null;
    out[pos[i]] ^= gdiv(y, prime);
  }
  for (i = 0; i < nsym; i++) if (peval(out, gpow(2, i))) return null;
  return out;
}

function deinterleave(cw, version, ecl) {
  var blocks = QRRSBlockD.getRSBlocks(version, ecl);
  var total = blocks.reduce(function (s, b) { return s + b.totalCount; }, 0);
  if (cw.length < total) return null;
  var data = blocks.map(function () { return []; }), ec = blocks.map(function () { return []; });
  var maxD = Math.max.apply(null, blocks.map(function (b) { return b.dataCount; }));
  var maxE = Math.max.apply(null, blocks.map(function (b) { return b.totalCount - b.dataCount; }));
  var k = 0;
  for (var i = 0; i < maxD; i++) blocks.forEach(function (b, bi) { if (i < b.dataCount) data[bi].push(cw[k++]); });
  for (i = 0; i < maxE; i++) blocks.forEach(function (b, bi) { if (i < b.totalCount - b.dataCount) ec[bi].push(cw[k++]); });
  var out = [];
  for (var bi = 0; bi < blocks.length; bi++) {
    var fixed = rsCorrect(data[bi].concat(ec[bi]), ec[bi].length);
    if (!fixed) return null;
    out = out.concat(fixed.slice(0, data[bi].length));
  }
  return out;
}

function parseSegments(bytes, version) {
  var pos = 0, total = bytes.length * 8;
  function read(n) {
    if (pos + n > total) throw 0;
    var v = 0;
    for (var i = 0; i < n; i++, pos++) v = (v << 1) | ((bytes[pos >> 3] >> (7 - (pos & 7))) & 1);
    return v;
  }
  var group = version < 10 ? 0 : version < 27 ? 1 : 2;
  var AN = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  var out = [], txt = '';
  try {
    while (pos + 4 <= total) {
      var mode = read(4);
      if (mode === 0) break;
      if (mode === 7) { read(8); continue; }                       // ECI (assume UTF-8 below)
      if (mode === 1) {
        var n = read([10, 12, 14][group]);
        while (n >= 3) { var v = read(10); txt += ('00' + v).slice(-3); n -= 3; }
        if (n === 2) txt += ('0' + read(7)).slice(-2); else if (n === 1) txt += read(4);
      } else if (mode === 2) {
        n = read([9, 11, 13][group]);
        while (n >= 2) { v = read(11); txt += AN[Math.floor(v / 45)] + AN[v % 45]; n -= 2; }
        if (n === 1) txt += AN[read(6)];
      } else if (mode === 4) {
        n = read([8, 16, 16][group]);
        var bs = [];
        for (var i = 0; i < n; i++) bs.push(read(8));
        try { txt += new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bs)); }
        catch (e) { txt += String.fromCharCode.apply(null, bs); }
      } else break;
    }
  } catch (e) { if (!txt) return null; }
  return txt;
}

/** Module size measured along the line from finder a toward finder b (true size even when rotated). */
function sizeToward(B, a, b) {
  var d = dist(a, b), ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  var m1 = measure(B, a.x, a.y, ux, uy, a.size * 14), m2 = measure(B, b.x, b.y, -ux, -uy, b.size * 14);
  var v = [];
  if (m1) v.push(m1.total / 7);
  if (m2) v.push(m2.total / 7);
  return v.length ? v.reduce(function (x, y) { return x + y; }, 0) / v.length : (a.size + b.size) / 2;
}

function tryDecode(B, tri) {
  var tl = tri.tl, tr = tri.tr, bl = tri.bl;
  var msH = sizeToward(B, tl, tr), msV = sizeToward(B, tl, bl);
  var ms = (msH + msV) / 2;
  var est = (dist(tl, tr) / msH + dist(tl, bl) / msV) / 2 + 7;
  var dim0 = Math.round(est);
  var dims = [];
  [0, 1, -1, 2, -2, 3, -3].forEach(function (k) { var d = dim0 + k; if ((d - 17) % 4 === 0 && d >= 21 && d <= 177 && dims.indexOf(d) < 0) dims.push(d); });
  for (var di = 0; di < dims.length; di++) {
    var dim = dims[di], version = (dim - 17) / 4;
    var src = [3.5, 3.5, dim - 3.5, 3.5, 0, 0, 3.5, dim - 3.5];
    var dst = [tl.x, tl.y, tr.x, tr.y, 0, 0, bl.x, bl.y];
    var al = version >= 2 ? findAlignment(B, tl, tr, bl, dim, ms) : null;
    if (al) { src[4] = dim - 6.5; src[5] = dim - 6.5; dst[4] = al.x; dst[5] = al.y; }
    else { src[4] = dim - 3.5; src[5] = dim - 3.5; dst[4] = tr.x - tl.x + bl.x; dst[5] = tr.y - tl.y + bl.y; }
    var tf = quadToQuad(src, dst);
    var m = sampleGrid(B, tf, dim);
    var fmt = readFormat(m, dim);
    if (!fmt) continue;
    var fmap = functionMap(version, fmt.ecl, dim);
    var cw = readCodewords(m, fmap, dim, fmt.mask);
    var data = deinterleave(cw, version, fmt.ecl);
    if (!data) continue;
    var txt = parseSegments(data, version);
    if (txt) return txt;
  }
  return null;
}

window.decodeQR = function (img) {
  var B = binarize(img);
  var found = findFinders(B);
  if (found.length < 3) return null;
  var tris = pickTriples(found);
  for (var i = 0; i < tris.length; i++) {
    var r = tryDecode(B, tris[i]);
    if (r) return r;
  }
  return null;
};

})();