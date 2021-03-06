const noop = require('../../core/utils/common').noop;
const typeUtils = require('../../core/utils/type');
const extend = require('../../core/utils/extend').extend;
const each = require('../../core/utils/iterator').each;
const mathUtils = require('../../core/utils/math');
const dateToMilliseconds = require('../../core/utils/date').dateToMilliseconds;
const domAdapter = require('../../core/dom_adapter');
const Color = require('../../color');
const isDefined = typeUtils.isDefined;
const isNumber = typeUtils.isNumeric;
const isExponential = typeUtils.isExponential;
const _math = Math;
const _round = _math.round;
const _sqrt = Math.sqrt;

const PI = Math.PI;
const MAX_PIXEL_COUNT = 1E10;
const PI_DIV_180 = PI / 180;
const LN10 = Math.LN10;

const cosFunc = Math.cos;
const sinFunc = Math.sin;
const abs = Math.abs;
const log = Math.log;
const floor = Math.floor;
const ceil = Math.ceil;
const max = Math.max;
const _isNaN = isNaN;
const _Number = Number;
const _NaN = NaN;

const { adjust, sign } = mathUtils;
const PANE_PADDING = 10;

const getLog = function(value, base) {
    if(!value) {
        return _NaN;
    }
    return Math.log(value) / Math.log(base);
};

const getAdjustedLog10 = function(value) {
    return adjust(getLog(value, 10));
};

const raiseTo = function(power, base) {
    return Math.pow(base, power);
};

//  Translates angle to [0, 360)
//  Expects number, no validation
const normalizeAngle = function(angle) {
    return ((angle % 360) + 360) % 360;
};

//  Maps angle in trigonometric space to angle in 'renderer' space
//  Expects numbers, no validation
const convertAngleToRendererSpace = function(angle) {
    return 90 - angle;
};

//  Maps angle in degrees to angle in radians
//  Expects number, no validation
const degreesToRadians = function(value) {
    return PI * value / 180;
};

//  Calculates sin and cos for <angle> in degrees
//  Expects number, no validation
const getCosAndSin = function(angle) {
    const angleInRadians = degreesToRadians(angle);
    return { cos: cosFunc(angleInRadians), sin: sinFunc(angleInRadians) };
};

//  Because Math.log(1000) / Math.LN10 < 3 though it is exactly 3
//  Same happens for 1E6, 1E9, 1E12, 1E13, 1E15, ...
const DECIMAL_ORDER_THRESHOLD = 1E-14;
//    ____________________
//   /       2          2
// \/ (y2-y1)  + (x2-x1)
const getDistance = function(x1, y1, x2, y2) {
    const diffX = x2 - x1;
    const diffY = y2 - y1;
    return Math.sqrt(diffY * diffY + diffX * diffX);
};

const getDecimalOrder = function(number) {
    let n = abs(number);
    let cn;
    if(!_isNaN(n)) {
        if(n > 0) {
            n = log(n) / LN10;
            cn = ceil(n);
            return cn - n < DECIMAL_ORDER_THRESHOLD ? cn : floor(n);
        }
        return 0;
    }
    return _NaN;
};

const getAppropriateFormat = function(start, end, count) {
    const order = max(getDecimalOrder(start), getDecimalOrder(end));
    let precision = -getDecimalOrder(abs(end - start) / count);
    let format;

    if(!_isNaN(order) && !_isNaN(precision)) {
        if(abs(order) <= 4) {
            format = 'fixedPoint';
            precision < 0 && (precision = 0);
            precision > 4 && (precision = 4);
        } else {
            format = 'exponential';
            precision += order - 1;
            precision > 3 && (precision = 3);
        }
        return { type: format, precision: precision };
    }
    return null;
};

const roundValue = function(value, precision) {
    if(precision > 20) {
        precision = 20;
    }
    if(isNumber(value)) {
        if(isExponential(value)) {
            return _Number(value.toExponential(precision));
        } else {
            return _Number(value.toFixed(precision));
        }
    }
};

const getPower = function(value) {
    return value.toExponential().split('e')[1];
};

function map(array, callback) {
    let i = 0;
    const len = array.length;
    const result = [];
    let value;

    while(i < len) {
        value = callback(array[i], i);
        if(value !== null) {
            result.push(value);
        }
        i++;
    }
    return result;
}

function selectByKeys(object, keys) {
    return map(keys, function(key) {
        return object[key] ? object[key] : null;
    });
}

function decreaseFields(object, keys, eachDecrease, decrease) {
    let dec = decrease;
    each(keys, function(_, key) {
        if(object[key]) {
            object[key] -= eachDecrease;
            dec -= eachDecrease;
        }
    });
    return dec;
}

function normalizeEnum(value) {
    return String(value).toLowerCase();
}

function setCanvasValues(canvas) {
    if(canvas) {
        canvas.originalTop = canvas.top;
        canvas.originalBottom = canvas.bottom;
        canvas.originalLeft = canvas.left;
        canvas.originalRight = canvas.right;
    }
    return canvas;
}

function normalizeBBoxField(value) {
    return -MAX_PIXEL_COUNT < value && value < +MAX_PIXEL_COUNT ? value : 0;
}

function normalizeBBox(bBox) {
    const xl = normalizeBBoxField(floor(bBox.x));
    const yt = normalizeBBoxField(floor(bBox.y));
    const xr = normalizeBBoxField(ceil(bBox.width + bBox.x));
    const yb = normalizeBBoxField(ceil(bBox.height + bBox.y));
    const result = {
        x: xl,
        y: yt,
        width: xr - xl,
        height: yb - yt
    };
    result.isEmpty = !result.x && !result.y && !result.width && !result.height;
    return result;
}

// Angle is expected to be from right-handed cartesian (not svg) space - positive is counterclockwise
function rotateBBox(bBox, center, angle) {
    const cos = _Number(cosFunc(angle * PI_DIV_180).toFixed(3));
    const sin = _Number(sinFunc(angle * PI_DIV_180).toFixed(3));
    const w2 = bBox.width / 2;
    const h2 = bBox.height / 2;
    const centerX = bBox.x + w2;
    const centerY = bBox.y + h2;
    const w2_ = abs(w2 * cos) + abs(h2 * sin);
    const h2_ = abs(w2 * sin) + abs(h2 * cos);
    // Note that the following slightly differs from theoretical formula:
    // x' = x * cos - y * sin, y' = x * sin + y * cos
    // That is because in svg y goes down (not up) - so sign of sin is reverted
    // x' = x * cos + y * sin, y' = -x * sin + y * cos
    const centerX_ = center[0] + (centerX - center[0]) * cos + (centerY - center[1]) * sin;
    const centerY_ = center[1] - (centerX - center[0]) * sin + (centerY - center[1]) * cos;
    return normalizeBBox({
        x: centerX_ - w2_,
        y: centerY_ - h2_,
        width: 2 * w2_,
        height: 2 * h2_
    });
}

extend(exports, {
    decreaseGaps: function(object, keys, decrease) {
        let arrayGaps;
        do {
            arrayGaps = selectByKeys(object, keys);
            arrayGaps.push(_math.ceil(decrease / arrayGaps.length));
            decrease = decreaseFields(object, keys, _math.min.apply(null, arrayGaps), decrease);
        } while(decrease > 0 && arrayGaps.length > 1);
        return decrease;
    },

    normalizeEnum: normalizeEnum,

    parseScalar: function(value, defaultValue) {
        return value !== undefined ? value : defaultValue;
    },

    enumParser: function(values) {
        const stored = {};
        let i;
        let ii;
        for(i = 0, ii = values.length; i < ii; ++i) {
            stored[normalizeEnum(values[i])] = 1;
        }
        return function(value, defaultValue) {
            const _value = normalizeEnum(value);
            return stored[_value] ? _value : defaultValue;
        };
    },

    patchFontOptions: function(options) {
        const fontOptions = {};
        each(options || {}, function(key, value) {
            if(/^(cursor)$/i.test(key)) {
                // TODO check other properties, add tests
            } else if(key === 'opacity') {
                value = null;
            } else if(key === 'color') {
                key = 'fill';
                if('opacity' in options) {
                    const color = new Color(value);
                    value = `rgba(${color.r},${color.g},${color.b},${options.opacity})`;
                }
            } else {
                key = 'font-' + key;
            }
            fontOptions[key] = value;
        });
        return fontOptions;
    },

    checkElementHasPropertyFromStyleSheet(element, property) {
        const slice = Array.prototype.slice;
        const cssRules = slice.call(domAdapter.getDocument().styleSheets).reduce((rules, styleSheet) => {
            return rules.concat(slice.call(styleSheet.cssRules || styleSheet.rules));
        }, []);

        const elementRules = cssRules.filter(rule => {
            try {
                return domAdapter.elementMatches(element, rule.selectorText);
            } catch(e) {
                return false;
            }
        });

        return elementRules.some(rule => !!rule.style[property]);
    },

    convertPolarToXY(centerCoords, startAngle, angle, radius) {
        const shiftAngle = 90;
        const normalizedRadius = radius > 0 ? radius : 0;

        angle = isDefined(angle) ? angle + startAngle - shiftAngle : 0;
        const cosSin = getCosAndSin(angle);

        return { x: _round(centerCoords.x + normalizedRadius * cosSin.cos), y: _round(centerCoords.y + normalizedRadius * cosSin.sin) };
    },

    convertXYToPolar: function(centerCoords, x, y) {
        const radius = getDistance(centerCoords.x, centerCoords.y, x, y);
        const angle = _math.atan2(y - centerCoords.y, x - centerCoords.x);

        return { phi: _round(normalizeAngle(angle * 180 / _math.PI)), r: _round(radius) };
    },

    processSeriesTemplate: function(seriesTemplate, items) {
        const customizeSeries = typeUtils.isFunction(seriesTemplate.customizeSeries) ? seriesTemplate.customizeSeries : noop;
        const nameField = seriesTemplate.nameField;
        const generatedSeries = {};
        const seriesOrder = [];
        let series;
        let i = 0;
        let length;
        let data;

        items = items || [];
        for(length = items.length; i < length; i++) {
            data = items[i];
            if(nameField in data) {
                series = generatedSeries[data[nameField]];
                if(!series) {
                    series = generatedSeries[data[nameField]] = { name: data[nameField], nameFieldValue: data[nameField] };
                    seriesOrder.push(series.name);
                }
            }
        }
        return map(seriesOrder, function(orderedName) {
            const group = generatedSeries[orderedName];
            return extend(group, customizeSeries.call(null, group.name));
        });
    },

    getCategoriesInfo: function(categories, startValue, endValue) {
        if(categories.length === 0) {
            return { categories: [] };
        }
        startValue = isDefined(startValue) ? startValue : categories[0];
        endValue = isDefined(endValue) ? endValue : categories[categories.length - 1];

        const categoriesValue = map(categories, function(category) {
            return isDefined(category) ? category.valueOf() : null;
        });
        let indexStartValue = categoriesValue.indexOf(startValue.valueOf());
        let indexEndValue = categoriesValue.indexOf(endValue.valueOf());
        let swapBuf;
        let inverted = false;

        indexStartValue < 0 && (indexStartValue = 0);
        indexEndValue < 0 && (indexEndValue = categories.length - 1);
        if(indexEndValue < indexStartValue) {
            swapBuf = indexEndValue;
            indexEndValue = indexStartValue;
            indexStartValue = swapBuf;
            inverted = true;
        }

        const visibleCategories = categories.slice(indexStartValue, indexEndValue + 1);
        const lastIdx = visibleCategories.length - 1;
        return {
            categories: visibleCategories,
            start: visibleCategories[inverted ? lastIdx : 0],
            end: visibleCategories[inverted ? 0 : lastIdx],
            inverted: inverted
        };
    },

    setCanvasValues: setCanvasValues,

    normalizePanesHeight(panes) {
        panes.forEach(pane => {
            const height = pane.height;
            let unit = 0;
            let parsedHeight = parseFloat(height) || undefined;

            if(typeUtils.isString(height) && height.indexOf('px') > -1 ||
                typeUtils.isNumeric(height) && height > 1) {
                parsedHeight = _round(parsedHeight);
                unit = 1;
            }

            if(!unit && parsedHeight) {
                if(typeUtils.isString(height) && height.indexOf('%') > -1) {
                    parsedHeight = parsedHeight / 100;
                } else if(parsedHeight < 0) {
                    parsedHeight = parsedHeight < -1 ? 1 : _math.abs(parsedHeight);
                }
            }

            pane.height = parsedHeight;
            pane.unit = unit;
        });
        const weightSum = panes.filter((pane) => !pane.unit)
            .reduce((prev, next) => prev + (next.height || 0), 0);
        const weightHeightCount = panes.filter((pane) => !pane.unit).length;
        const emptyHeightCount = panes.filter((pane) => !pane.unit && !pane.height).length;

        if(weightSum < 1 && emptyHeightCount) {
            panes.filter((pane) => !pane.unit && !pane.height).forEach((pane) => pane.height = (1 - weightSum) / emptyHeightCount);
        } else if(weightSum > 1 || weightSum < 1 && !emptyHeightCount || weightSum === 1 && emptyHeightCount) {
            if(emptyHeightCount) {
                const weightForEmpty = weightSum / weightHeightCount;
                const emptyWeightSum = emptyHeightCount * weightForEmpty;
                panes.filter((pane) => !pane.unit && pane.height).forEach((pane) => pane.height *= (weightSum - emptyWeightSum) / weightSum);
                panes.filter((pane) => !pane.unit && !pane.height).forEach((pane) => pane.height = weightForEmpty);
            }
            panes.forEach((pane) => !pane.unit && (pane.height *= 1 / weightSum));
        }
    },

    updatePanesCanvases(panes, canvas, rotated) {
        let distributedSpace = 0;
        const padding = PANE_PADDING;
        const paneSpace = rotated ? canvas.width - canvas.left - canvas.right : canvas.height - canvas.top - canvas.bottom;
        let usefulSpace = paneSpace - padding * (panes.length - 1);
        const startName = rotated ? 'left' : 'top';
        const endName = rotated ? 'right' : 'bottom';

        const totalCustomSpace = panes.reduce((prev, cur) => prev + (cur.unit ? cur.height : 0), 0);
        usefulSpace -= totalCustomSpace;

        panes.forEach(pane => {
            const calcLength = pane.unit ? pane.height : _round(pane.height * usefulSpace);
            pane.canvas = pane.canvas || {};
            extend(pane.canvas, canvas);
            pane.canvas[startName] = canvas[startName] + distributedSpace;
            pane.canvas[endName] = canvas[endName] + (paneSpace - calcLength - distributedSpace);

            distributedSpace = distributedSpace + calcLength + padding;
            setCanvasValues(pane.canvas);
        });
    },

    unique: function(array) {
        const values = {};
        return map(array, function(item) {
            const result = !values[item] ? item : null;
            values[item] = true;
            return result;
        });
    },

    map: map,

    getVerticallyShiftedAngularCoords: function(bBox, dy, center) {
        // TODO: Use center instead of left top corner - that is more correct and allows to get rid of "isPositive"
        //   horizontalOffset1 = bBox.x + bBox.width / 2 - center.x
        //   horizontalOffset2 = bBox.y + bBox.height / 2 - center.y
        //   verticalOffset2 = newCoord.y + bBox.height / 2 - center.y
        const isPositive = bBox.x + bBox.width / 2 >= center.x;
        const horizontalOffset1 = (isPositive ? bBox.x : bBox.x + bBox.width) - center.x;
        const verticalOffset1 = bBox.y - center.y;
        const verticalOffset2 = verticalOffset1 + dy;
        const horizontalOffset2 = _round(_sqrt(horizontalOffset1 * horizontalOffset1 + verticalOffset1 * verticalOffset1 - verticalOffset2 * verticalOffset2));
        const dx = (isPositive ? +horizontalOffset2 : -horizontalOffset2) || horizontalOffset1;
        return { x: center.x + (isPositive ? dx : dx - bBox.width), y: bBox.y + dy };
    },

    mergeMarginOptions(opt1, opt2) {
        return {
            checkInterval: opt1.checkInterval || opt2.checkInterval,
            size: Math.max(opt1.size || 0, opt2.size || 0),
            percentStick: opt1.percentStick || opt2.percentStick,
            sizePointNormalState: Math.max(opt1.sizePointNormalState || 0, opt2.sizePointNormalState || 0)
        };
    }
});

function getVizRangeObject(value) {
    if(Array.isArray(value)) {
        return { startValue: value[0], endValue: value[1] };
    } else {
        return value || {};
    }
}

function convertVisualRangeObject(visualRange, convertToVisualRange) {
    if(convertToVisualRange) {
        return visualRange;
    }
    return [visualRange.startValue, visualRange.endValue];
}

function getAddFunction(range, correctZeroLevel) {
    // T170398
    if(range.dataType === 'datetime') {
        return function(rangeValue, marginValue, sign = 1) {
            return new Date(rangeValue.getTime() + sign * marginValue);
        };
    }

    if(range.axisType === 'logarithmic') {
        return function(rangeValue, marginValue, sign = 1) {
            const log = getLogExt(rangeValue, range.base) + sign * marginValue;
            return raiseToExt(log, range.base);
        };
    }

    return function(rangeValue, marginValue, sign = 1) {
        const newValue = rangeValue + sign * marginValue;
        return correctZeroLevel && newValue * rangeValue <= 0 ? 0 : newValue;
    };
}

function adjustVisualRange(options, visualRange, wholeRange, dataRange) {
    const minDefined = typeUtils.isDefined(visualRange.startValue);
    const maxDefined = typeUtils.isDefined(visualRange.endValue);
    const nonDiscrete = options.axisType !== 'discrete';

    dataRange = dataRange || wholeRange;

    const add = getAddFunction(options, false);

    let min = minDefined ? visualRange.startValue : dataRange.min;
    let max = maxDefined ? visualRange.endValue : dataRange.max;
    let rangeLength = visualRange.length;
    const categories = dataRange.categories;

    if(nonDiscrete && !typeUtils.isDefined(min) && !typeUtils.isDefined(max)) {
        return {
            startValue: min,
            endValue: max
        };
    }

    if(isDefined(rangeLength)) {
        if(nonDiscrete) {
            if(options.dataType === 'datetime' && !isNumber(rangeLength)) {
                rangeLength = dateToMilliseconds(rangeLength);
            }

            if(maxDefined && !minDefined || !maxDefined && !minDefined) {
                isDefined(wholeRange.max) && (max = max > wholeRange.max ? wholeRange.max : max);
                min = add(max, rangeLength, -1);
            } else if(minDefined && !maxDefined) {
                isDefined(wholeRange.min) && (min = min < wholeRange.min ? wholeRange.min : min);
                max = add(min, rangeLength);
            }
        } else {
            rangeLength = parseInt(rangeLength);
            if(!isNaN(rangeLength) && isFinite(rangeLength)) {
                rangeLength--;
                if(!maxDefined && !minDefined) {
                    max = categories[categories.length - 1];
                    min = categories[categories.length - 1 - rangeLength];
                } else if(minDefined && !maxDefined) {
                    const categoriesInfo = exports.getCategoriesInfo(categories, min, undefined);
                    max = categoriesInfo.categories[rangeLength];
                } else if(!minDefined && maxDefined) {
                    const categoriesInfo = exports.getCategoriesInfo(categories, undefined, max);
                    min = categoriesInfo.categories[categoriesInfo.categories.length - 1 - rangeLength];
                }
            }
        }
    }

    if(nonDiscrete) {
        if(isDefined(wholeRange.max) && max > wholeRange.max) {
            max = wholeRange.max;
        }
        if(isDefined(wholeRange.min) && min < wholeRange.min) {
            min = wholeRange.min;
        }
    }

    return {
        startValue: min,
        endValue: max
    };
}

function getLogExt(value, base, allowNegatives = false, linearThreshold) {
    if(!allowNegatives) {
        return getLog(value, base);
    }
    if(value === 0) {
        return 0;
    }
    const transformValue = getLog(Math.abs(value), base) - (linearThreshold - 1);
    if(transformValue < 0) {
        return 0;
    }
    return adjust(sign(value) * transformValue, Number(Math.pow(base, linearThreshold - 1).toFixed(Math.abs(linearThreshold))));
}

function raiseToExt(value, base, allowNegatives = false, linearThreshold) {
    if(!allowNegatives) {
        return raiseTo(value, base);
    }

    if(value === 0) {
        return 0;
    }

    const transformValue = raiseTo(Math.abs(value) + (linearThreshold - 1), base);

    if(transformValue < 0) {
        return 0;
    }

    return adjust(sign(value) * transformValue, Number(Math.pow(base, linearThreshold).toFixed(Math.abs(linearThreshold))));
}

function rangesAreEqual(range, rangeFromOptions) {
    if(Array.isArray(rangeFromOptions)) {
        return range.length === rangeFromOptions.length
            && range.every((item, i) => valueOf(item) === valueOf(rangeFromOptions[i]));
    } else {
        return valueOf(range.startValue) === valueOf(rangeFromOptions.startValue)
            && valueOf(range.endValue) === valueOf(rangeFromOptions.endValue);
    }
}

function valueOf(value) {
    return value && value.valueOf();
}

function pointInCanvas(canvas, x, y) {
    return (x >= canvas.left && x <= canvas.right && y >= canvas.top && y <= canvas.bottom);
}

exports.getVizRangeObject = getVizRangeObject;
exports.convertVisualRangeObject = convertVisualRangeObject;
exports.adjustVisualRange = adjustVisualRange;
exports.getAddFunction = getAddFunction;
exports.getLog = getLog;
exports.getLogExt = getLogExt;
exports.getAdjustedLog10 = getAdjustedLog10;
exports.raiseTo = raiseTo;
exports.raiseToExt = raiseToExt;

exports.normalizeAngle = normalizeAngle;
exports.convertAngleToRendererSpace = convertAngleToRendererSpace;
exports.degreesToRadians = degreesToRadians;
exports.getCosAndSin = getCosAndSin;
exports.getDecimalOrder = getDecimalOrder;
exports.getAppropriateFormat = getAppropriateFormat;
exports.getDistance = getDistance;

exports.roundValue = roundValue;
exports.getPower = getPower;

exports.rotateBBox = rotateBBox;
exports.normalizeBBox = normalizeBBox;
exports.PANE_PADDING = PANE_PADDING;

exports.rangesAreEqual = rangesAreEqual;
exports.pointInCanvas = pointInCanvas;
