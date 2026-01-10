module.exports = function requestTimeout(ms = 30000) {
  return (req, res, next) => {
    req.setTimeout(ms, () => {
      const err = new Error("Upload timeout - traje predugo.");
      err.status = 408;
      next(err);
    });
    next();
  };
};
