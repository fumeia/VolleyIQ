package com.volleyiq.app.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BallSearchTest {

    @Test
    fun tilesCoverThePlayersZoomedIn() {
        val people = listOf(Box(100f, 500f, 160f, 650f), Box(1700f, 600f, 1780f, 800f), Box(900f, 200f, 930f, 270f))
        val tiles = BallSearch.tiles(people, 1920, 1080)
        assertTrue(tiles.size in 2..4)
        for (p in people) assertTrue("$p not covered", tiles.any { it.left <= p.left && it.right >= p.right && it.top <= p.top && it.bottom >= p.bottom })
        for (t in tiles) assertTrue(t.width < 1920 * 0.75f && t.left >= 0 && t.right <= 1920 && t.top >= 0 && t.bottom <= 1080)
    }

    @Test
    fun closenessIsRelativeToPlayerSize() {
        val far = listOf(Box(0f, 0f, 20f, 60f))
        val near = listOf(Box(0f, 0f, 100f, 300f))
        assertEquals(1.0, BallSearch.closeness(10f, 10f, far), 1e-9)
        // 60 px beside a small (far) player is far away; beside a big (near) one it is arm's reach.
        assertTrue(BallSearch.closeness(80f, 30f, far) < 0.2)
        assertTrue(BallSearch.closeness(160f, 30f, near) > 0.6)
    }
}
