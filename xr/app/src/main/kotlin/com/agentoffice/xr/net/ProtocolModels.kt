package com.agentoffice.xr.net

import org.json.JSONArray
import org.json.JSONObject

/** Minimal worker row for the connected dashboard (from `WorkerInfo`). */
data class WorkerSummary(
    val id: String,
    val name: String,
    val status: String,
    val deskId: String,
)

/** Minimal peer row for the connected dashboard (from `PeerInfo`). */
data class PeerSummary(
    val id: String,
    val name: String,
    val floor: String?,
)

/**
 * The slice of office state this scaffold mirrors: identity + current floor +
 * peers + workers. Built from `welcome`, replaced wholesale by `floor.enter`, and
 * patched by `peer.*` / `worker.*` events — mirroring how the web client's store
 * treats floor-scoped state.
 */
data class OfficeSnapshot(
    val you: String,
    val version: String,
    /**
     * `welcome.protocolVersion` (`docs/vr-protocol.md`, currently 1). Recorded and
     * logged; `0` means the server predates versioning. Minor additions never bump
     * it, so unknown `t` values stay fail-soft.
     */
    val protocolVersion: Int,
    val floorId: String?,
    val floorName: String,
    val peers: List<PeerSummary>,
    val workers: List<WorkerSummary>,
)

private data class FloorView(
    val floorId: String?,
    val floorName: String,
    val peers: List<PeerSummary>,
    val workers: List<WorkerSummary>,
)

/** Parse the first message on connect (`welcome` + inline `FloorView`). */
fun parseWelcome(json: JSONObject): OfficeSnapshot {
    require(json.optString("t") == "welcome") { "expected t=welcome, got '${json.optString("t")}'" }
    val view = parseFloorView(json)
    return OfficeSnapshot(
        you = json.getString("you"),
        version = json.optString("version", ""),
        protocolVersion = json.optInt("protocolVersion", 0),
        floorId = view.floorId,
        floorName = view.floorName,
        peers = view.peers,
        workers = view.workers,
    )
}

/** Apply `floor.enter`: replaces all floor-scoped state, keeps identity. */
fun applyFloorEnter(current: OfficeSnapshot, json: JSONObject): OfficeSnapshot {
    require(json.optString("t") == "floor.enter") {
        "expected t=floor.enter, got '${json.optString("t")}'"
    }
    val view = parseFloorView(json)
    return current.copy(
        floorId = view.floorId,
        floorName = view.floorName,
        peers = view.peers,
        workers = view.workers,
    )
}

/**
 * Apply `peer.join` / `peer.update` / `peer.leave`. Other `peer.*` messages
 * (`peer.move`, `peer.act`, `peer.emote`) carry no dashboard state and are ignored.
 */
fun applyPeerEvent(current: OfficeSnapshot, json: JSONObject): OfficeSnapshot =
    when (json.optString("t")) {
        "peer.join", "peer.update" -> {
            val peer = parsePeer(json.getJSONObject("peer"))
            current.copy(peers = current.peers.filterNot { it.id == peer.id } + peer)
        }
        "peer.leave" -> current.copy(peers = current.peers.filterNot { it.id == json.getString("id") })
        else -> current
    }

/** Apply `worker.update` / `worker.remove`. Other `worker.*` messages are ignored. */
fun applyWorkerEvent(current: OfficeSnapshot, json: JSONObject): OfficeSnapshot =
    when (json.optString("t")) {
        "worker.update" -> {
            val worker = parseWorker(json.getJSONObject("worker"))
            current.copy(workers = current.workers.filterNot { it.id == worker.id } + worker)
        }
        "worker.remove" ->
            current.copy(workers = current.workers.filterNot { it.id == json.getString("workerId") })
        else -> current
    }

/** `ping {at}` — clock-sync ClientMsg. */
fun pingMessage(at: Long): JSONObject = JSONObject().put("t", "ping").put("at", at)

private fun parseFloorView(json: JSONObject): FloorView {
    val floorId = json.optString("floor").takeIf { it.isNotEmpty() }
    // Prefer the project display name; fall back to the raw floor id.
    val floorName = json.optJSONObject("project")
        ?.optString("name", "")
        ?.takeIf { it.isNotEmpty() }
        ?: floorId
        ?: "Office"
    return FloorView(
        floorId = floorId,
        floorName = floorName,
        peers = json.optJSONArray("peers")?.objects()?.map(::parsePeer) ?: emptyList(),
        workers = json.optJSONArray("workers")?.objects()?.map(::parseWorker) ?: emptyList(),
    )
}

private fun parsePeer(json: JSONObject): PeerSummary = PeerSummary(
    id = json.getString("id"),
    name = json.optString("name", "Guest"),
    floor = json.optString("floor").takeIf { it.isNotEmpty() },
)

private fun parseWorker(json: JSONObject): WorkerSummary = WorkerSummary(
    id = json.getString("id"),
    name = json.optString("name", "worker"),
    status = json.optString("status", "unknown"),
    deskId = json.optString("deskId", ""),
)

private fun JSONArray.objects(): List<JSONObject> =
    (0 until length()).mapNotNull { optJSONObject(it) }
