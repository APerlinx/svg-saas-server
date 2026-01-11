const sanitizeInput = (str: string): string => {
  return str.trim().replace(/\u0000/g, '')
}
export { sanitizeInput }
