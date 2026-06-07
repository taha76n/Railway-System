export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// .catch(next)   ===   .catch(err => next(err));

// More Readable

// export default fn => async (req, res, next) => {
//   try {
//     await fn(req, res, next);
//   } catch (err) {
//     next(err);
//   }
// };