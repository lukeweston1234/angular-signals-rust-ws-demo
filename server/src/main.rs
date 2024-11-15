use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::AtomicUsize;
use futures_util::{SinkExt, StreamExt, TryFutureExt};
use tokio::sync::{mpsc, RwLock};
use tokio_stream::wrappers::UnboundedReceiverStream;
use warp::Filter;
use warp::ws::{Message, WebSocket};
use serde::{Deserialize, Serialize};

type Users = Arc<RwLock<HashMap<usize, mpsc::UnboundedSender<Message>>>>;

static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type", content = "data")]
enum MessageType {
    Draw(DrawCommand),
    Clear,
    Erase(EraseCommand),
}

#[derive(Serialize, Deserialize, Debug)]
struct DrawCommand {
    prev: [f64; 2],
    cur: [f64; 2],
    color: String,
    brush_size: u32,
}

#[derive(Serialize, Deserialize, Debug)]
struct EraseCommand {
    prev: [f64; 2],
    cur: [f64; 2],
    brush_size: u32,
}

#[tokio::main]
async fn main() {
    let users = Users::default();

    let users = warp::any().map(move || users.clone()); // This applies users, almost like middleware to each path

    let routes = warp::path("room")
        .and(warp::ws())
        .and(users)
        .map(|ws: warp::ws::Ws, users| {
            ws.on_upgrade(move |socket| connect_user(socket, users))
        });

    warp::serve(routes).run(([127, 0, 0, 1], 8080)).await;
}

async fn connect_user(ws: WebSocket, users: Users){
    let current_user_id = NEXT_USER_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let (mut user_ws_sender, mut user_ws_receiver) = ws.split();

    let (message_sender, message_receiver) = mpsc::unbounded_channel();
    let mut rx = UnboundedReceiverStream::new(message_receiver);

    tokio::task::spawn(async move {
        while let Some(message) = rx.next().await {
            user_ws_sender
                .send(message)
                .unwrap_or_else(|e| {
                    eprintln!("WebSocket send error: {}", e)
                }).await;
        }
    });

    users.write().await.insert(current_user_id, message_sender);

    while let Some(result) = user_ws_receiver.next().await {
        let msg = match result {
            Ok(msg) => msg,
            Err(e) => {
                eprintln!("Could not send user message {}", e);
                break;
            } 
        };
        send_user_message(current_user_id, msg, &users).await;
    }

    user_disconnected(current_user_id, &users).await;
}

async fn send_user_message(user_id: usize, msg: Message, users: &Users){
   if let Ok(s) = msg.to_str() {
    let parsed: Result<MessageType, serde_json::Error> = serde_json::from_str(s);
    match parsed {
        Ok(msg) => {
            let serialized = serde_json::to_string(&msg).unwrap_or_else(|e| {
                eprintln!("Serialization error: {}", e);
                String::new()
            });
            for (&uid, tx) in users.read().await.iter() {
                if user_id != uid {
                    if let Err(_disconnected) = tx.send(Message::text(&serialized)){
                        println!("User disconnected");
                    }
                }
            }
        },
        Err(e) => eprintln!("Whoops, could not serialize: {:?}", e)
    }
   };
}

async fn user_disconnected(my_id: usize, users: &Users) {
    eprintln!("good bye user: {}", my_id);

    // Stream closed up, so remove from the user list
    users.write().await.remove(&my_id);
}