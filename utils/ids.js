const isAppId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ''));

module.exports = {
  isAppId
};
