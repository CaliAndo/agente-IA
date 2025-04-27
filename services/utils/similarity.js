// 📁 services/utils/similarity.js

function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
  if (magnitudeA * magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

module.exports = {
  cosineSimilarity,
};
