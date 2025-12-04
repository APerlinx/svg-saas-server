const sanitizeInput = (str: string): string => {
  return str.trim().replace(/[<>]/g, '') // Remove < and > to prevent XSS
}
export { sanitizeInput }
