"use strict";
const crypto=require("node:crypto");
function protectedActionHash(token,user){
 if(typeof token!=="string"||!token||!user?.session_id||!user?.id)throw new Error("Authenticated session required");
 return crypto.createHash("sha256").update(JSON.stringify(["protected-action-v2",String(user.id),String(user.session_id),Number(user.token_version||0),token])).digest("hex");
}
module.exports={protectedActionHash};
