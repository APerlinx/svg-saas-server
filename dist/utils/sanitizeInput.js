"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeInput = void 0;
const sanitizeInput = (str) => {
    return str.trim().replace(/\u0000/g, '');
};
exports.sanitizeInput = sanitizeInput;
