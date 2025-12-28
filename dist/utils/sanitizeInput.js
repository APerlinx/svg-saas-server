"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeInput = void 0;
const sanitizeInput = (str) => {
    return str.trim().replace(/[<>]/g, ''); // Remove < and > to prevent XSS
};
exports.sanitizeInput = sanitizeInput;
