package com.volleyiq.app.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Sends the suggestions file to the VolleyIQ server. Runs with a network
 * constraint and retries with backoff, so analysis done in a gym without
 * signal is uploaded once the phone is online again.
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val file = File(inputData.getString(AnalysisWorker.KEY_FILE) ?: return@withContext Result.failure())
        val matchId = inputData.getLong(AnalysisWorker.KEY_MATCH, 0)
        val apiBase = inputData.getString(KEY_API)?.trimEnd('/') ?: return@withContext Result.failure()
        val token = inputData.getString(KEY_TOKEN)
        if (!file.exists()) return@withContext Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "Results file missing"))

        val paramsFile = File(file.path + ".params.json")
        val candidatesFile = File(file.path + ".candidates.json")
        val body = JSONObject().put("events", JSONArray(file.readText())).put("replace", true).apply {
            if (paramsFile.exists()) runCatching { put("params", JSONObject(paramsFile.readText())) }
            // All sound peaks of the run (also below the threshold), for learning better thresholds.
            if (candidatesFile.exists()) runCatching { put("candidates", JSONArray(candidatesFile.readText())) }
        }.toString()
        try {
            val conn = (URL("$apiBase/api/matches/$matchId/suggestions").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 15_000
                readTimeout = 60_000
                setRequestProperty("Content-Type", "application/json")
                if (!token.isNullOrEmpty()) setRequestProperty("Authorization", "Bearer $token")
            }
            conn.outputStream.use { it.write(body.toByteArray()) }
            val code = conn.responseCode
            val text = (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
            conn.disconnect()
            when {
                code in 200..299 -> {
                    file.delete()
                    paramsFile.delete()
                    candidatesFile.delete()
                    Result.success(workDataOf(AnalysisWorker.KEY_COUNT to JSONObject(text).optInt("inserted")))
                }
                code == 401 -> Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "Not logged in on the server; log in again and re-run"))
                code in 400..499 -> Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "Server refused the results: $text"))
                else -> Result.retry()
            }
        } catch (e: java.io.IOException) {
            Result.retry()
        }
    }

    companion object {
        const val KEY_API = "apiBase"
        const val KEY_TOKEN = "token"
    }
}
