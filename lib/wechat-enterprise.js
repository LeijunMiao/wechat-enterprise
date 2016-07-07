var urllib = require('urllib');
var extend = require('util')._extend;

var URLS = {
  GET_TOKEN: "https://qyapi.weixin.qq.com/cgi-bin/gettoken",//gettoken?corpid=id&corpsecret=secrect\
  SEND_MSG: "https://qyapi.weixin.qq.com/cgi-bin/message/send"
};

var AccessToken = function (data) {
  if (!(this instanceof AccessToken)) {
    return new AccessToken(data);
  }
  this.data = data;
};

/*!
 * 检查AccessToken是否有效，检查规则为当前时间和过期时间进行对比
 */
AccessToken.prototype.isValid = function () {
  return !!this.data.access_token && (new Date().getTime()) < (this.data.create_at + this.data.expires_in * 1000);
};


/*!
 * 处理token，更新过期时间
 */
var processToken = function (that, callback) {
  return function (err, data, res) {
    if (err) {
      return callback(err, data);
    }
    data.create_at = new Date().getTime();
    // 存储token
    that.saveToken(that.corpid, data, function (err) {
      callback(err, new AccessToken(data));
    });
  };
};

/**
 * 根据corpid和corpsecret创建WechatEnterprise接口的构造函数
 * 如需跨进程跨机器进行操作，access token需要进行全局维护
 * 使用使用token的优先级是：
 *
 * 1. 使用当前缓存的token对象
 * 2. 调用开发传入的获取token的异步方法，获得token之后使用（并缓存它）。
 * Examples:
 * ```
 * var WechatEnterprise = require('wechat-enterprise');
 * var api = new WechatEnterprise('corpid', 'corpsecret');
 * ```
 * @param {String} corpid 在公众平台上申请得到的corpid
 * @param {String} corpsecret 在公众平台上申请得到的corpsecret
 * @param {Function} getToken 用于获取token的方法
 * @param {Function} saveToken 用于保存token的方法
 */
var WechatEnterprise = function (corpid, corpsecret, getToken, saveToken) {
  this.corpid = corpid;
  this.corpsecret = corpsecret;
  // token的获取和存储
  this.store = {};
  this.getToken = getToken || function (corpid, callback) {
    callback(null, this.store[corpid]);
  };
  if (!saveToken && process.env.NODE_ENV === 'production') {
    console.warn("Please dont save oauth token into memory under production");
  }
  this.saveToken = saveToken || function (corpid, token, callback) {
    this.store[corpid] = token;
    callback(null);
  };
  this.defaults = {};
};

/**
 * 对返回结果的一层封装，如果遇见微信返回的错误，将返回一个错误
 * 参见：http://mp.weixin.qq.com/wiki/index.php?title=返回码说明
 */
var wrapper = function (callback) {
  return function (err, data, res) {
    callback = callback || function () { };
    if (err) {
      err.name = 'WeChatAPI' + err.name;
      return callback(err, data, res);
    }
    if (data.errcode) {
      err = new Error(data.errmsg);
      err.name = 'WeChatAPIError';
      err.code = data.errcode;
      return callback(err, data, res);
    }
    callback(null, data, res);
  };
};

/*!
 * urllib的封装
 *
 * @param {String} url 路径
 * @param {Object} opts urllib选项
 * @param {Function} callback 回调函数
 */
WechatEnterprise.prototype.request = function (url, opts, callback) {
  var options = {};
  extend(options, this.defaults);
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  for (var key in opts) {
    if (key !== 'headers') {
      options[key] = opts[key];
    } else {
      if (opts.headers) {
        options.headers = options.headers || {};
        extend(options.headers, opts.headers);
      }
    }
  }
  urllib.request(url, options, callback);
};

/*!
 * 换取access token
 */
WechatEnterprise.prototype.getAccessToken = function (callback) {
  var info = {
    corpid: this.corpid,
    corpsecret: this.corpsecret
  };
  var args = {
    data: info,
    dataType: 'json'
  };
  this.request(URLS.GET_TOKEN, args, wrapper(processToken(this, callback)));
};

WechatEnterprise.prototype._sendMsg = function (options, accessToken, callback) {
  var args = {
    method: 'POST',
    content: JSON.stringify({
      "touser": options.touser,
      "msgtype": "text",
      "agentid": options.agentid || 0,
      "text": {
        "content": options.text
      },
      "safe": "0"
    }),
    contentType: 'json',
    dataType: 'json'
  };
  this.request(URLS.SEND_MSG + '?access_token=' + accessToken, args, wrapper(processToken(this, callback)));
};

/**
 * 根据corpid，发消息。
 * 当access token无效时，获取新的access token。然后再发消息
 * Examples:
 * ```
 * api.sendMsg(options, callback);
 * ```
 *
 * Options:
 * ```
 * {
 *   "touser": "UserID1|UserID2|UserID3",
 *   "toparty": " PartyID1 | PartyID2 ",
 *   "totag": " TagID1 | TagID2 ",
 *   "msgtype": "text",
 *   "agentid": 1,
 *   "text": {
 *      "content": "Holiday Request For Pony(http://xxxxx)"
 *   },
 *   "safe":"0"
 * }
 * ```
 * Callback:
 *
 * - `err`, 获取用户信息出现异常时的异常对象
 * - `result`, 成功时得到的响应结果
 *
 * Result:
 * ```
 * ```
 * @param {Object|String} options 传入参数
 * @param {Function} callback 回调函数
 */
WechatEnterprise.prototype.sendMsg = function (options, callback) {
  var that = this;
  this.getToken(that.corpid, function (err, data) {
    if (err) {
      return callback(err);
    }
    // 没有token数据
    if (!data) {
      var error = new Error('No token for ' + that.corpid + ', please authorize first.');
      error.name = 'NoOAuthTokenError';
      return callback(error);
    }
    var token = new AccessToken(data);
    if (token.isValid()) {
      that._sendMsg(options, token.data.access_token, callback);
    } else {
      that.getAccessToken(function (err, token) {
        if (err) {
          return callback(err);
        }
        that._sendMsg(options, token.data.access_token, callback);
      });
    }
  });
};


// RedPack.prototype.sendRedPack = function (params, callback) {
//   var requiredData = ['mch_billno', 'wxappid', 'send_name', 're_openid',
//     'total_amount', 'wishing', 'client_ip', 'act_name', 'remark'];
//   params.total_num = 1;
//   this._signedQuery(URLS.SEND_REDPACK, params, {
//     https: true,
//     required: requiredData
//   }, callback);
// };

// RedPack.prototype.sendGroupRedPack = function (params, callback) {
//   var requiredData = ['mch_billno', 'wxappid', 'send_name', 're_openid',
//     'total_amount', 'total_num', 'amt_type', 'wishing', 'act_name', 'remark'];
//   params.amt_type = 'ALL_RAND';
//   this._signedQuery(URLS.SEND_GROUP_REDPACK, params, {
//     https: true,
//     required: requiredData
//   }, callback);
// };

exports.WechatEnterprise = WechatEnterprise;