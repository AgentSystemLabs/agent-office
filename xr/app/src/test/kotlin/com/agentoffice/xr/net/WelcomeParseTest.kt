package com.agentoffice.xr.net

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * Golden `welcome` fixture shaped like the real server message
 * (`ServerMsg` in `src/shared/protocol.ts`): `welcome` fields plus inline `FloorView`.
 */
private const val GOLDEN_WELCOME = """
{
  "t": "welcome",
  "you": "peer-1",
  "version": "dev-abc123",
  "protocolVersion": 1,
  "floor": "agent-office",
  "project": {"name": "agent-office", "dir": "/Users/nik/agent-office"},
  "floors": [{"id": "agent-office", "name": "agent-office"}],
  "peers": [
    {
      "id": "peer-1", "name": "VR Guest", "color": "#4F86F7",
      "x": 0, "y": 0, "z": 0, "rotY": 0, "moving": false,
      "voice": false, "muted": false, "sharing": false,
      "floor": "agent-office"
    },
    {
      "id": "peer-2", "name": "Nik", "color": "#ff0000",
      "x": 1, "y": 0, "z": 2, "rotY": 0, "moving": true,
      "voice": true, "muted": false, "sharing": false,
      "floor": "agent-office"
    }
  ],
  "workers": [
    {"id": "w-1", "kind": "agent", "deskId": "desk-3", "name": "Pixel",
     "color": "#00ff00", "status": "working", "acked": true,
     "createdBy": "peer-2", "createdAt": 1759000000000},
    {"id": "w-2", "kind": "shell", "deskId": "desk-1", "name": "shell-1",
     "color": "#0000ff", "status": "idle", "acked": true,
     "createdBy": "peer-2", "createdAt": 1759000001000}
  ]
}
"""

class WelcomeParseTest {

    private fun golden(): OfficeSnapshot = parseWelcome(JSONObject(GOLDEN_WELCOME))

    @Test
    fun `parses identity and version`() {
        val snapshot = golden()

        assertEquals("peer-1", snapshot.you)
        assertEquals("dev-abc123", snapshot.version)
        assertEquals(1, snapshot.protocolVersion)
    }

    @Test
    fun `missing protocolVersion defaults to zero`() {
        val snapshot = parseWelcome(JSONObject("""{"t":"welcome","you":"a"}"""))

        assertEquals(0, snapshot.protocolVersion)
    }

    @Test
    fun `resolves floor name from project`() {
        val snapshot = golden()

        assertEquals("agent-office", snapshot.floorId)
        assertEquals("agent-office", snapshot.floorName)
    }

    @Test
    fun `parses peers`() {
        val snapshot = golden()

        assertEquals(2, snapshot.peers.size)
        assertEquals(PeerSummary("peer-1", "VR Guest", "agent-office"), snapshot.peers[0])
        assertEquals(PeerSummary("peer-2", "Nik", "agent-office"), snapshot.peers[1])
    }

    @Test
    fun `parses workers`() {
        val snapshot = golden()

        assertEquals(2, snapshot.workers.size)
        assertEquals(WorkerSummary("w-1", "Pixel", "working", "desk-3"), snapshot.workers[0])
        assertEquals(WorkerSummary("w-2", "shell-1", "idle", "desk-1"), snapshot.workers[1])
    }

    @Test
    fun `floor enter replaces floor-scoped state and keeps identity`() {
        val before = golden()
        val enter = JSONObject(
            """
            {
              "t": "floor.enter",
              "floor": "other-project",
              "project": {"name": "Other Project"},
              "peers": [{"id": "peer-9", "name": "Sam"}],
              "workers": []
            }
            """.trimIndent(),
        )

        val after = applyFloorEnter(before, enter)

        assertEquals("peer-1", after.you)
        assertEquals("dev-abc123", after.version)
        assertEquals("other-project", after.floorId)
        assertEquals("Other Project", after.floorName)
        assertEquals(listOf(PeerSummary("peer-9", "Sam", null)), after.peers)
        assertEquals(emptyList<WorkerSummary>(), after.workers)
    }

    @Test
    fun `peer join upserts and leave removes`() {
        val before = golden()

        val joined = applyPeerEvent(
            before,
            JSONObject("""{"t":"peer.join","peer":{"id":"peer-3","name":"Ada"}}"""),
        )
        assertEquals(3, joined.peers.size)
        assertEquals(PeerSummary("peer-3", "Ada", null), joined.peers.last())

        val updated = applyPeerEvent(
            joined,
            JSONObject("""{"t":"peer.update","peer":{"id":"peer-3","name":"Ada II"}}"""),
        )
        assertEquals(3, updated.peers.size)
        assertEquals("Ada II", updated.peers.last().name)

        val left = applyPeerEvent(updated, JSONObject("""{"t":"peer.leave","id":"peer-3"}"""))
        assertEquals(2, left.peers.size)
    }

    @Test
    fun `worker update upserts and remove deletes`() {
        val before = golden()

        val updated = applyWorkerEvent(
            before,
            JSONObject(
                """{"t":"worker.update","worker":{"id":"w-1","name":"Pixel","status":"done","deskId":"desk-3"}}""",
            ),
        )
        assertEquals(2, updated.workers.size)
        assertEquals("done", updated.workers.first { it.id == "w-1" }.status)

        val removed = applyWorkerEvent(updated, JSONObject("""{"t":"worker.remove","workerId":"w-1"}"""))
        assertEquals(listOf("w-2"), removed.workers.map { it.id })
    }

    @Test
    fun `non-dashboard events leave the snapshot untouched`() {
        val before = golden()

        assertSame(before, applyPeerEvent(before, JSONObject("""{"t":"peer.move","id":"peer-2"}""")))
        assertSame(before, applyWorkerEvent(before, JSONObject("""{"t":"worker.worktree","workerId":"w-1"}""")))
    }

    @Test
    fun `peer without floor parses to null floor`() {
        val snapshot = parseWelcome(
            JSONObject(
                """{"t":"welcome","you":"a","peers":[{"id":"p","name":"N"}],"workers":[]}""",
            ),
        )

        assertNull(snapshot.peers.single().floor)
        assertEquals("Office", snapshot.floorName)
    }
}
