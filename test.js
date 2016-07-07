var WechatEnterprise = require('./lib/wechat-enterprise').WechatEnterprise;

var config = {
  corpid: "",
  corpsecret: "",
}

var getToken = function (corpid, callback) {
  WechatQYToken.findOne({ corpid: corpid }, function (err, swap) {
    if (err || swap === null) {
      if (err) logger.error(err);
      return callback(true);
    }
    callback(err, swap.token);
  });
};

var saveToken = function (corpid, token, callback) {
  var update = {
    corpid: corpid,
    token: token
  }
  WechatQYToken.findOneAndUpdate({ corpid: corpid }, { $set: update }, { upsert: true }, function (err, swap) {
    return callback(err);
  });
}

var we = new WechatEnterprise(config.corpid, config.corpsecret, getToken, saveToken);
we.sendMsg(options, function (err, data) {
  if (err) {
    logger.error(err);
    return;
  }
});