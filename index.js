var Promise = require('bluebird')
var csv = Promise.promisifyAll(require('csv'))
var fs = Promise.promisifyAll(require("fs"))
var _ = require("underscore")
var Shopify = require("shopify-promise")

var shopify = new Shopify({
  "shop": process.env.SHOPIFY_SHOP,
  "password": process.env.SHOPIFY_PASSWORD
})

function doc(){
  return fs.readFileAsync("./sheet.csv", "utf8").then(function(doc){
    return csv.parseAsync(doc, {columns: true})
  })
  .then(_).call("map", function(row){
    var int = parseInt(row["Customer PO"], 10)
    row["shopify-order-number"] = (int) ? int : null
    return row
  })
  .then(_).call("filter", function(row){
    return row["shopify-order-number"] !== ""
  })
  .then(_).call("filter", function(row){
    return row["shopify-order-number"] !== null
  })
}

function arrayToObject(arr, key){
  return _.map(arr, function(item){
    var temp = {}
    temp[key] = item
    return temp
  })
}

function lineItemArrayFromOrder(order){
  return _.map(order.line_items, function(line_item){
    return [
      line_item.id,
      line_item.fulfillment_service
    ]
  })
}

function findOrder(orders, orderNumber){
  if(!orderNumber) return null
  var order =  _.findWhere(orders, {
    "order_number": orderNumber
  })
  return (order) ? order : null
}

function formatOrderNumber(orderNumber){
  if(!orderNumber) return null
  if(orderNumber == "") return null
  var parse = parseInt(orderNumber)
  return (parse) ? parse : null
}

Promise.props({
  "doc": doc(),
  "orders": shopify.retrieveAllOrders()
}).then(function(data){
  data.rich = _.chain(data.doc).map(function(row){
    var temp = {}
    temp["shopify_order_number"] = formatOrderNumber(row["Customer PO"])
    temp["shopify_order"] = findOrder(data.orders, temp["shopify_order_number"])
    temp["tracking"] = row["Tracking / PRO #"]
    return temp
  }).filter(function(row){
    return row["shopify_order"] && row["shopify_order"].fulfillment_status !== "fulfilled"
  }).map(function(row){
    row["fulfill_line_items"] = _.chain(row["shopify_order"].line_items).filter(function(line_item){
      return line_item.fulfillment_service == "manual"
    }).map(function(line_item){
      return {
        "id": line_item.id
      }
    }).value()
    return row
  }).value()
  return data
}).then(function(data){
  return Promise.map(data.rich, function(row){
    console.log("fulfilling order: " + row["shopify_order"].id)
    return shopify.request({
      "method": "POST",
      "path": "/admin/orders/"+row["shopify_order"].id+"/fulfillments.json",
      "body": {
        "fulfillment": {
          "tracking_number": row["tracking"],
          "notify_customer": false,
          "line_items": row["fulfill_line_items"]
        }
      }
    })
  }).then(function(response){
    console.log(response)
    data.response = response
    return data
  })
})
