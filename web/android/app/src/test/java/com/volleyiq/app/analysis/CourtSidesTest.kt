package com.volleyiq.app.analysis

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class CourtSidesTest {

    private val square = listOf(0.1, 0.9, 0.0, 0.0, 0.9, 0.9, 9.0, 0.0, 0.7, 0.3, 9.0, 18.0, 0.3, 0.3, 0.0, 18.0).joinToString(",")

    @Test
    fun picksTheStretchForEachTime() {
        val sides = CourtSides.parse("""[{"from":0,"ourHalf":"near","points":[$square]},{"from":600,"ourHalf":"far","points":[$square]},{"from":1250.5,"ourHalf":"near"}]""")!!
        assertEquals("near", sides.ourHalf(10.0))
        assertEquals("far", sides.ourHalf(600.0))
        assertEquals("near", sides.ourHalf(5000.0))
        assertEquals(listOf(1, 2, 3), listOf(1.0, 900.0, 1300.0).map { sides.setNo(it) })
        assertNotNull(sides.homography(700.0))
        assertNull(sides.homography(1300.0)) // no points sent for that stretch
    }

    @Test
    fun singleCalibrationHasNoSetNumbers() {
        assertNull(CourtSides.single(null, "near").setNo(100.0))
        assertNull(CourtSides.parse("not json"))
        assertNull(CourtSides.parse(null))
    }
}
